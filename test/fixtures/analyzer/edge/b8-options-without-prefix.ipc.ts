import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

// B8: an options literal without `eventPrefix` yields no `eventPrefix` and no warning.
export const noPrefix = defineIpcModule(
  "no-prefix",
  { ping: handle(async () => 1) },
  { ready: () => undefined },
);
