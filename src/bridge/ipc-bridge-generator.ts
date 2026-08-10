import type { AnalyzedIpcModule, ChannelInfo, EmittedEventInfo } from "../shared/types/bridge.js";
import { toCamelCase, toPascalCase } from "../shared/utils.js";

const IDENTIFIER_PATTERN = /^[$A-Z_a-z][$\w]*$/;

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
function generateImportLine() {
  return `import { ipcRenderer } from 'electron';`;
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
 * helpers (when needed), and a `bridge` object with one entry per module.
 */
export function generateBridge(modules: AnalyzedIpcModule[]) {
  assertUniqueIdentifiers(
    modules.map((ipcModule) => [
      toCamelCase(ipcModule.name),
      `module file ${JSON.stringify(ipcModule.name + ".ipc.ts")}`,
    ]),
    "IPC bridge",
  );
  const hasEmittedEvents = modules.some((ipcModule) => ipcModule.emittedEvents.length > 0);
  const lines = [generateImportLine(), generateSerializableImportLine(), ""];

  if (hasEmittedEvents) {
    lines.push(...generateEventHelpers());
  }

  const moduleEntries = modules.map(generateModuleEntry);

  lines.push(`export const bridge = {\n${moduleEntries.join(",\n")},\n} as const;`, "");

  return lines.join("\n");
}
