import {
  createIpcHelpers,
  defineIpcEvents,
  defineIpcModule,
} from "../../../../src/runtime/ipc-module.js";

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
