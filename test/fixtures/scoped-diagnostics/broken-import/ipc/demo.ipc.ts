import { defineIpcModule, handle } from "../../../../../src/runtime/ipc-module.js";
import type { Payload } from "../shared/payload.js";

export const demo = defineIpcModule("demo", {
  get: handle((): Payload => ({ id: "1" })),
});
