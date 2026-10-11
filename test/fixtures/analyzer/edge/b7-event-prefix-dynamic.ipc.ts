import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

declare const flag: boolean;

// B7: a non-literal `eventPrefix` cannot be resolved statically: warning.
export const prefixDynamic = defineIpcModule(
  "prefix-dynamic",
  { ping: handle(async () => 1) },
  { eventPrefix: flag },
);
