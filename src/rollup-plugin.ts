import type { Plugin } from "rollup";
import { runIpcBridgeGeneration, type IpcBridgeOptions } from "./bridge/ipc-bridge.js";

export type { IpcBridgeOptions } from "./bridge/ipc-bridge.js";

/**
 * Rollup plugin that regenerates the typed preload bridge from `*.ipc.ts`
 * files at the start of every build.
 */
export default function ipcBridge(options: IpcBridgeOptions = {}): Plugin {
  return {
    name: "ipc-bridge",
    buildStart() {
      runIpcBridgeGeneration(options);
    },
  };
}
