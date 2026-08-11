import { defineIpcModule, handle } from "../../../../../src/runtime/ipc-module.js";

// `UmdTypes` arrives through `export as namespace`, without an import edge.
export const demo = defineIpcModule("demo", {
  get: handle((): UmdTypes.Payload => ({ id: "1" })),
});
