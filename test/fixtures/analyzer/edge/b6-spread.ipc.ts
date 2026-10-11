import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

const shared = { fromSpread: handle(async () => 1) };

// B6: spread entries cannot be typed in the bridge and produce a warning.
export const spread = defineIpcModule("spread", {
  ...shared,
  own: handle(async () => 2),
});
