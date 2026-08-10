import type { Plugin } from "rollup";
import {
  getIpcBridgeWatchTargets,
  isIpcBridgeRelevantFile,
  runIpcBridgeGeneration,
  type IpcBridgeOptions,
} from "./bridge/ipc-bridge.js";

export type { IpcBridgeOptions } from "./bridge/ipc-bridge.js";
export type { LoggerLike } from "./shared/types/runtime.js";

/**
 * Rollup plugin that regenerates the typed preload bridge from `*.ipc.ts`
 * files at the start of every build.
 */
export default function ipcBridge(options: IpcBridgeOptions = {}): Plugin {
  let generateOnNextBuild = true;

  return {
    name: "ipc-bridge",
    buildStart() {
      for (const file of getIpcBridgeWatchTargets(options)) {
        this.addWatchFile(file);
      }
      if (generateOnNextBuild) {
        runIpcBridgeGeneration(options);
      }
      generateOnNextBuild = false;
    },
    watchChange(id) {
      if (isIpcBridgeRelevantFile(id, options)) {
        generateOnNextBuild = true;
      }
    },
  };
}
