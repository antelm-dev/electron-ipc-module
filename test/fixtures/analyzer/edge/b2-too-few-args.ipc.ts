import { defineIpcModule } from "../../../../src/runtime/ipc-module.js";

// B2: fewer than two arguments, so there is no channels object to analyze.
// @ts-expect-error deliberately invalid call
export const tooFew = defineIpcModule("too-few");
