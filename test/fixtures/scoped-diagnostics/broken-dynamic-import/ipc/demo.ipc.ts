import { defineIpcModule, handle } from "../../../../../src/runtime/ipc-module.js";

export const demo = defineIpcModule("demo", {
  get: handle(async () => {
    const { helper } = await import("../shared/payload.js");
    return helper();
  }),
});
