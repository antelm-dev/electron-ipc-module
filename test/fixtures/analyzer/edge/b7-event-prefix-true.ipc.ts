import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

// B7: `eventPrefix: true` reuses the module prefix.
export const prefixTrue = defineIpcModule(
  "prefix-true",
  { ping: handle(async () => 1) },
  { eventPrefix: true },
);
