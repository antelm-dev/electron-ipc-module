import type { Plugin } from "rollup";
import {
  getIpcBridgeWatchTargets,
  runIpcBridgeGeneration,
  type IpcBridgeOptions,
} from "./bridge/ipc-bridge.js";

export type { IpcBridgeOptions } from "./bridge/ipc-bridge.js";

/**
 * Rollup plugin that regenerates the typed preload bridge from `*.ipc.ts`
 * files at the start of every build.
 */
export default function ipcBridge(options: IpcBridgeOptions = {}): Plugin {
  return {
    name: "ipc-bridge",
    buildStart() {
      for (const file of getIpcBridgeWatchTargets(options)) {
        this.addWatchFile(file);
      }
      runIpcBridgeGeneration(options);
    },
  };
}
