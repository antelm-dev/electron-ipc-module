import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

// Two modules in one file: the bridge has one entry per file, so this cannot be
// generated and the analyzer must reject it rather than drop `beta`.
export const alpha = defineIpcModule("alpha", { ping: handle(() => "a") });
export const beta = defineIpcModule("beta", { pong: handle(() => "b") });
