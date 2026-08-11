/// <reference path="../globals.ts" />
import { defineIpcModule, handle } from "../../../../../src/runtime/ipc-module.js";

// The handler's type comes from the global declaration, not from any import.
export const demo = defineIpcModule("demo", {
  get: handle((): GlobalPayload => ({ id: "1" })),
});
