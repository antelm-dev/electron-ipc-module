import { defineIpcModule, handle } from "../../../../../src/runtime/ipc-module.js";

// No import statement anywhere: the dependency is referenced inline, which is
// exactly what a serialized type from the analyzer looks like.
export const demo = defineIpcModule("demo", {
  get: handle((): import("../shared/payload.js").Payload => ({ id: "1" })),
});
