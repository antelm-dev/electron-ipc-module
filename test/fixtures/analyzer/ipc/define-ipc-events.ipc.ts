import { defineIpcEvents, defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

type StatusEvents = {
  "status-changed": [online: boolean];
};

export const statusEvents = defineIpcEvents<StatusEvents>();

export const createStatusIpc = defineIpcModule("status", {
  ping: handle(async () => "ok"),
});
