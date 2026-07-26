import * as Ipc from "../../../../src/runtime/ipc-module.js";

export const createNamespacedIpc = Ipc.defineIpcModule("namespaced", {
  ping: Ipc.handle(async () => "ok"),
});
