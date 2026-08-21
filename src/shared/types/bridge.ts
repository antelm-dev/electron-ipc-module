import type { LoggerLike } from "./runtime.js";

/** User-facing options for the Rollup bridge plugin. */
export interface IpcBridgeOptions {
  /** Directory or glob of `*.ipc.ts` files. Defaults to `./src/ipc`. */
  ipcDir?: string;
  /** Path of the generated bridge file. Defaults to `./src/generated/ipc-bridge.ts`. */
  outFile?: string;
  /** tsconfig used to type-check the analyzed files. Defaults to `./tsconfig.json`. */
  tsconfig?: string;
  /**
   * Where generation progress and analyzer warnings go. Defaults to a labelled
   * console logger that prints `info` and above.
   *
   * Supply one to silence the generator in a watch loop, to route output into a
   * build tool's own reporter, or to see the per-module `debug` detail the
   * default logger drops.
   */
  logger?: LoggerLike;
  /**
   * Global key to expose the bridge under, e.g. `"ipc"` for `window.ipc`.
   *
   * When set, the generated file also calls `contextBridge.exposeInMainWorld`
   * and declares the matching `Window` member, so the exposed key and the type
   * the renderer sees are produced from one source instead of two hand-written
   * files that can drift apart.
   *
   * Left unset the bridge is only exported, and wiring both up is yours to do.
   */
  expose?: string;
}

/** {@link IpcBridgeOptions} with defaults applied and paths normalized. */
export interface ResolvedIpcBridgeOptions {
  ipcDir: string;
  outFile: string;
  tsconfig: string;
  logger: LoggerLike;
  expose?: string;
}

/** A single analyzed channel of an IPC module. */
export interface ChannelInfo {
  /** Channel key (before prefixing), e.g. `"get-all"`. */
  key: string;
  /** `true` for `handle`/`handleOnce`, `false` for `listen`/`listenOnce`. */
  isHandler: boolean;
  /** Serialized argument tuple type, or `null` when there are no args. */
  argsType: string | null;
  /** Serialized (awaited) return type; `"any"` for listeners. */
  returnType: string;
}

/** A single event a module emits to the renderer. */
export interface EmittedEventInfo {
  /** Event name, e.g. `"profile-updated"`. */
  key: string;
  /** Serialized argument tuple type, or `null` when there are no args. */
  argsType: string | null;
}

/** The full analysis result for one `*.ipc.ts` module. */
export interface AnalyzedIpcModule {
  /** Module name derived from the file name (without `.ipc.ts`). */
  name: string;
  /** Channel prefix passed to `defineIpcModule`. */
  prefix: string;
  /** Optional physical prefix applied to emitted renderer event channels. */
  eventPrefix?: string;
  channels: ChannelInfo[];
  emittedEvents: EmittedEventInfo[];
  /** Non-fatal issues found while analyzing (e.g. spreads, duplicate events). */
  warnings: string[];
  /** Absolute POSIX path of the source file. */
  fileName: string;
}
