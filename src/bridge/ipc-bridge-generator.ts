import type { AnalyzedIpcModule, ChannelInfo, EmittedEventInfo } from "../shared/types/bridge.js";
import { toCamelCase, toPascalCase } from "../shared/utils.js";

/** The `electron` import line, including `IpcRendererEvent` when events exist. */
function generateImportLine(hasEmittedEvents: boolean) {
  return hasEmittedEvents
    ? `import { ipcRenderer, type IpcRendererEvent } from 'electron';`
    : `import { ipcRenderer } from 'electron';`;
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
    "  const wrapped = (_event: IpcRendererEvent, ...args: TArgs) => {",
    "    listener(...args);",
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
    "  const wrapped = (_event: IpcRendererEvent, ...args: TArgs) => {",
    "    listener(...args);",
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
  const paramDecl = channel.argsType ? `...args: ${channel.argsType}` : "";
  const forward = channel.argsType ? ", ...args" : "";
  const returnAnnotation = channel.isHandler ? `Promise<${channel.returnType}>` : "void";

  return `    ${camelKey}: (${paramDecl}): ${returnAnnotation} => ipcRenderer.${method}(${JSON.stringify(channelName)}${forward})`;
}

/** The `on<Event>` / `once<Event>` subscription methods for one emitted event. */
function generateEventEntries(event: EmittedEventInfo) {
  const argsType = event.argsType ?? "[]";
  const listenerType = event.argsType ? `(...args: ${event.argsType}) => void` : "() => void";
  const pascalKey = toPascalCase(event.key);
  const channel = JSON.stringify(event.key);

  return [
    `    on${pascalKey}: (listener: ${listenerType}): Unsubscribe => createOnHelper<${argsType}>(${channel}, listener)`,
    `    once${pascalKey}: (listener: ${listenerType}): Unsubscribe => createOnceHelper<${argsType}>(${channel}, listener)`,
  ];
}

/** The `name: { … }` block grouping a module's channels and event helpers. */
function generateModuleEntry(ipcModule: AnalyzedIpcModule) {
  const channelEntries = [
    ...ipcModule.channels.map((channel) => generateChannelEntry(channel, ipcModule.prefix)),
    ...ipcModule.emittedEvents.flatMap(generateEventEntries),
  ];

  return `  ${toCamelCase(ipcModule.name)}: {\n${channelEntries.join(",\n")},\n  }`;
}

/**
 * Render the full `ipc-bridge.ts` source: the `electron` import, shared event
 * helpers (when needed), and a `bridge` object with one entry per module.
 */
export function generateBridge(modules: AnalyzedIpcModule[]) {
  const hasEmittedEvents = modules.some((ipcModule) => ipcModule.emittedEvents.length > 0);
  const lines = [generateImportLine(hasEmittedEvents), ""];

  if (hasEmittedEvents) {
    lines.push(...generateEventHelpers());
  }

  const moduleEntries = modules.map(generateModuleEntry);

  lines.push(`export const bridge = {\n${moduleEntries.join(",\n")},\n} as const;`, "");

  return lines.join("\n");
}
