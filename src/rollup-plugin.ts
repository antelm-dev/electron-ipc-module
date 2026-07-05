import type { Plugin } from "rollup";
import {
  runIpcBridgeGeneration,
  type IpcBridgeOptions,
} from "./ipc-bridge.js";

export type { IpcBridgeOptions } from "./ipc-bridge.js";

export default function ipcBridge(options: IpcBridgeOptions = {}): Plugin {
  return {
    name: "ipc-bridge",
    buildStart() {
      runIpcBridgeGeneration(options);
    },
  };
}
