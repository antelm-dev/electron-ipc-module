import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

function defineIpcEvents<TEvents extends Record<string, readonly unknown[]>>() {
  return {} as TEvents;
}

type StatusEvents = {
  "status-changed": [online: boolean];
};

export const statusEvents = defineIpcEvents<StatusEvents>();

export const createStatusIpc = defineIpcModule("status", {
  ping: handle(async () => "ok"),
});
