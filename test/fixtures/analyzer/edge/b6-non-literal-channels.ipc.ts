import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

const channels = { ping: handle(async () => 1) };

// B6: a channels argument that is not an object literal has nothing to scan
// for spreads, but its channels are still read from its type.
export const nonLiteralChannels = defineIpcModule("non-literal-channels", channels);
