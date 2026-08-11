import { defineIpcModule, handle } from "../../../../../src/runtime/ipc-module.js";

// Deliberately broken, in the IPC file the analyzer reads types from.
export const brokenInSource: string = 42;

export const demo = defineIpcModule("demo", {
  get: handle((): string => "ok"),
});
