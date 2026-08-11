import { defineIpcModule, handle } from "../../../../../src/runtime/ipc-module.js";

// `AmbientPayload` arrives from a global augmentation. There is nothing in
// this file linking to the file that declares it.
export const demo = defineIpcModule("demo", {
  get: handle((): AmbientPayload => ({ id: "1" })),
});
