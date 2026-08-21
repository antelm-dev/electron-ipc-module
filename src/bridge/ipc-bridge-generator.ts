import { resolve } from "node:path";

import ts from "typescript";

import type { AnalyzedIpcModule, ChannelInfo, EmittedEventInfo } from "../shared/types/bridge.js";
import { toCamelCase, toPascalCase } from "../shared/utils.js";

const IDENTIFIER_PATTERN = /^[$A-Z_a-z][$\w]*$/;

/**
 * The standard globals an `expose` key cannot reuse. Derive these from the
 * consumer's installed TypeScript rather than freezing one DOM version's
 * `Window` members into this package. `globalThis` also includes ECMAScript
 * globals (`Array`, `undefined`, …) that Electron refuses to overwrite.
 */
let standardGlobalKeys: ReadonlySet<string> | undefined;

function getStandardGlobalKeys(): ReadonlySet<string> {
  if (standardGlobalKeys) return standardGlobalKeys;

  const probeFile = resolve(ts.sys.getCurrentDirectory(), "__electron_ipc_module_globals__.ts");
  const probeSource = ts.createSourceFile(
    probeFile,
    "globalThis;",
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const compilerOptions: ts.CompilerOptions = {
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(compilerOptions);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === probeFile
      ? probeSource
      : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);

  const program = ts.createProgram([probeFile], compilerOptions, host);
  const checker = program.getTypeChecker();
  const statement = probeSource.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) {
    throw new Error("Failed to inspect TypeScript's standard global declarations");
  }

  const keys = new Set(
    checker
      .getPropertiesOfType(checker.getTypeAtLocation(statement.expression))
      .map(({ name }) => name),
  );
  const windowSymbol = checker
    .getSymbolsInScope(probeSource, ts.SymbolFlags.Interface)
    .find(({ name }) => name === "Window");
  if (!windowSymbol) {
    throw new Error("Failed to inspect TypeScript's Window declarations");
  }
  for (const { name } of checker.getPropertiesOfType(
    checker.getDeclaredTypeOfSymbol(windowSymbol),
  )) {
    keys.add(name);
  }
  // V8's `Has` check also follows `Window`'s prototype chain. TypeScript's
  // `globalThis` type omits a few Object-prototype members such as
  // `constructor`, so include that final standard layer explicitly.
  for (const key of Object.getOwnPropertyNames(Object.prototype)) keys.add(key);

  standardGlobalKeys = keys;
  return keys;
}

function assertIdentifier(identifier: string, description: string) {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(
      `${description} produces invalid bridge identifier ${JSON.stringify(identifier)}`,
    );
  }
}

function assertUniqueIdentifiers(
  entries: Array<[identifier: string, source: string]>,
  scope: string,
) {
  const seen = new Map<string, string>();
  for (const [identifier, source] of entries) {
    assertIdentifier(identifier, source);
    const previous = seen.get(identifier);
    if (previous) {
      throw new Error(
        `${scope} contains a generated identifier collision for ${JSON.stringify(identifier)}: ${previous} and ${source}`,
      );
    }
    seen.set(identifier, source);
  }
}

/**
 * Wrap a serialized type so the bridge describes what the renderer receives
 * rather than what the main process returned. See `Serializable`.
 */
function serializable(typeStr: string) {
  return `Serializable<${typeStr}>`;
}

/** The runtime `electron` import line. */
function generateImportLine(expose: string | undefined) {
  const imports = expose === undefined ? "ipcRenderer" : "contextBridge, ipcRenderer";
  return `import { ${imports} } from 'electron';`;
}

/**
 * The `contextBridge` call and the `Window` member that describes it.
 *
 * Both are emitted from the same key so the exposed name and the type the
 * renderer sees cannot disagree: hand-written, that mismatch type-checks and
 * then leaves `window.<key>` undefined at runtime.
 */
function generateExposeLines(expose: string) {
  assertIdentifier(expose, "expose option");
  if (getStandardGlobalKeys().has(expose)) {
    throw new Error(
      `expose option ${JSON.stringify(expose)} is already a standard global property, which ` +
        `Electron cannot overwrite and TypeScript cannot safely redeclare. ` +
        `Pick a key of your own, such as "ipc".`,
    );
  }
  return [
    "",
    `contextBridge.exposeInMainWorld(${JSON.stringify(expose)}, bridge);`,
    "",
    "declare global {",
    "  interface Window {",
    `    ${expose}: typeof bridge;`,
    "  }",
    "}",
  ];
}

/** Type-only import of `Serializable`, erased at build time. */
function generateSerializableImportLine() {
  return `import type { Serializable } from 'electron-ipc-module';`;
}

/** The shared `createOnHelper`/`createOnceHelper` source emitted once per bridge. */
function generateEventHelpers() {
  return [
    "type Unsubscribe = () => void;",
    "",
    "function createOnHelper<TArgs extends any[]>(",
    "  channel: string,",
    "  listener: (...args: TArgs) => void,",
    "): Unsubscribe {",
    "  const wrapped = (...rawArgs: any[]) => {",
    "    listener(...(rawArgs.slice(1) as TArgs));",
    "  };",
    "",
    "  ipcRenderer.on(channel, wrapped);",
    "  return () => ipcRenderer.removeListener(channel, wrapped);",
    "}",
    "",
    "function createOnceHelper<TArgs extends any[]>(",
    "  channel: string,",
    "  listener: (...args: TArgs) => void,",
    "): Unsubscribe {",
    "  const wrapped = (...rawArgs: any[]) => {",
    "    listener(...(rawArgs.slice(1) as TArgs));",
    "  };",
    "",
    "  ipcRenderer.once(channel, wrapped);",
    "  return () => ipcRenderer.removeListener(channel, wrapped);",
    "}",
    "",
  ];
}

/** One bridge method that invokes/sends on a channel, e.g. `getAll: (…) => …`. */
function generateChannelEntry(channel: ChannelInfo, prefix: string) {
  const channelName = prefix ? `${prefix}:${channel.key}` : channel.key;
  const camelKey = toCamelCase(channel.key);
  const method = channel.isHandler ? "invoke" : "send";
  const paramDecl = channel.argsType ? `...args: ${serializable(channel.argsType)}` : "";
  const forward = channel.argsType ? ", ...args" : "";
  const returnAnnotation = channel.isHandler
    ? `Promise<${serializable(channel.returnType)}>`
    : "void";

  return `    ${camelKey}: (${paramDecl}): ${returnAnnotation} => ipcRenderer.${method}(${JSON.stringify(channelName)}${forward})`;
}

/** The `on<Event>` / `once<Event>` subscription methods for one emitted event. */
function generateEventEntries(event: EmittedEventInfo, eventPrefix?: string) {
  const argsType = event.argsType ? serializable(event.argsType) : "[]";
  const listenerType = event.argsType ? `(...args: ${argsType}) => void` : "() => void";
  const pascalKey = toPascalCase(event.key);
  const channel = JSON.stringify(eventPrefix ? `${eventPrefix}:${event.key}` : event.key);

  return [
    `    on${pascalKey}: (listener: ${listenerType}): Unsubscribe => createOnHelper<${argsType}>(${channel}, listener)`,
    `    once${pascalKey}: (listener: ${listenerType}): Unsubscribe => createOnceHelper<${argsType}>(${channel}, listener)`,
  ];
}

/** The `name: { … }` block grouping a module's channels and event helpers. */
function generateModuleEntry(ipcModule: AnalyzedIpcModule) {
  assertUniqueIdentifiers(
    [
      ...ipcModule.channels.map(
        (channel) =>
          [toCamelCase(channel.key), `channel ${JSON.stringify(channel.key)}`] as [string, string],
      ),
      ...ipcModule.emittedEvents.flatMap((event) => [
        [`on${toPascalCase(event.key)}`, `event ${JSON.stringify(event.key)} on-listener`] as [
          string,
          string,
        ],
        [`once${toPascalCase(event.key)}`, `event ${JSON.stringify(event.key)} once-listener`] as [
          string,
          string,
        ],
      ]),
    ],
    `IPC module ${JSON.stringify(ipcModule.name)}`,
  );
  const channelEntries = [
    ...ipcModule.channels.map((channel) => generateChannelEntry(channel, ipcModule.prefix)),
    ...ipcModule.emittedEvents.flatMap((event) =>
      generateEventEntries(event, ipcModule.eventPrefix),
    ),
  ];

  return `  ${toCamelCase(ipcModule.name)}: {\n${channelEntries.join(",\n")},\n  }`;
}

/**
 * Render the full `ipc-bridge.ts` source: the `electron` import, shared event
 * helpers (when needed), a `bridge` object with one entry per module, and —
 * with `expose` — the `contextBridge` call and `Window` declaration for it.
 */
export function generateBridge(modules: AnalyzedIpcModule[], options: { expose?: string } = {}) {
  assertUniqueIdentifiers(
    modules.map((ipcModule) => [
      toCamelCase(ipcModule.name),
      `module file ${JSON.stringify(ipcModule.name + ".ipc.ts")}`,
    ]),
    "IPC bridge",
  );
  const hasEmittedEvents = modules.some((ipcModule) => ipcModule.emittedEvents.length > 0);
  const lines = [generateImportLine(options.expose), generateSerializableImportLine(), ""];

  if (hasEmittedEvents) {
    lines.push(...generateEventHelpers());
  }

  const moduleEntries = modules.map(generateModuleEntry);

  lines.push(`export const bridge = {\n${moduleEntries.join(",\n")},\n} as const;`);
  // Not a truthiness check: `expose: ""` is an invalid key to report, not a
  // quiet opt-out of the exposure it asked for.
  if (options.expose !== undefined) lines.push(...generateExposeLines(options.expose));
  lines.push("");

  return lines.join("\n");
}
