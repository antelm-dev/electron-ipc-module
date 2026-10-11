import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

// B3: keys starting with "__" are reserved and never reach the bridge.
export const reserved = defineIpcModule("reserved", {
  __internal: handle(async () => "hidden"),
  visible: handle(async () => "shown"),
});
