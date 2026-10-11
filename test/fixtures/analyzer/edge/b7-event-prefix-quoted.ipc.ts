import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

// B7: "eventPrefix" written as a quoted key reuses the module prefix. The
// formatter would strip the quotes and lose the path under test, hence:
// oxfmt-ignore
export const prefixQuoted = defineIpcModule("prefix-quoted", { ping: handle(async () => 1) }, { "eventPrefix": true });
