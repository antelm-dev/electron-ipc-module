import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

// B7: a string literal `eventPrefix` is used as written. The unrelated
// `ready` property is skipped while looking for it.
export const prefixString = defineIpcModule(
  "prefix-string",
  { ping: handle(async () => 1) },
  { ready: () => undefined, eventPrefix: "custom" },
);
