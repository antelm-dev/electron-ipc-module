import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

// B8: an options literal without `eventPrefix` (including a numeric key that is
// neither an identifier nor a string) yields no `eventPrefix` and no warning.
export const noPrefix = defineIpcModule(
  "no-prefix",
  { ping: handle(async () => 1) },
  // @ts-expect-error numeric key is not a known option
  { 1: true, ready: () => undefined },
);
