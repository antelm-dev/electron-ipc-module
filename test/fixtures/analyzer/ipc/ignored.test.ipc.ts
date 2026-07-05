import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

export const createIgnoredTestIpc = defineIpcModule("ignored-test", {
  ping: handle(async () => "should not appear"),
});
