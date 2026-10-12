import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

const options = { eventPrefix: true };

// B8: options passed by reference are not read, so no `eventPrefix` results.
export const nonLiteralOptions = defineIpcModule(
  "non-literal-options",
  { ping: handle(async () => 1) },
  options,
);
