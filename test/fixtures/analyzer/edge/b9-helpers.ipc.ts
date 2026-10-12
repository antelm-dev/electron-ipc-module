import { createIpcHelpers, defineIpcModule } from "../../../../src/runtime/ipc-module.js";

// B9: a declaration without initializer, and `createIpcHelpers()` without a
// type argument, both contribute no emitted events.
export let later: number;
const { handle } = createIpcHelpers();

export const helpers = defineIpcModule("helpers", { ping: handle(async () => 1) });
