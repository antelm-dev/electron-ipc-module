import { createIpcHelpers, defineIpcModule } from "../../../../src/runtime/ipc-module.js";

function defineIpcEvents<TEvents extends Record<string, readonly unknown[]>>() {
  return {} as TEvents;
}

type HelperEvents = {
  "shared-event": [source: string];
};

const { handle } = createIpcHelpers<HelperEvents>();

type ExportedEvents = {
  "shared-event": [source: string];
};

export const exportedEvents = defineIpcEvents<ExportedEvents>();

export const createDuplicateEventsIpc = defineIpcModule("dupe", {
  ping: handle(async () => "pong"),
});
