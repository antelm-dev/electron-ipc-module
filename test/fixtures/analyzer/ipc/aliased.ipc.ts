import {
  createIpcHelpers as helpers,
  defineIpcEvents as declareEvents,
  defineIpcModule as defineModule,
  handle as ipcHandle,
} from "../../../../src/runtime/ipc-module.js";

type AliasedEvents = {
  "aliased-ready": [ok: boolean];
};

export const aliasedEvents = declareEvents<AliasedEvents>();

const { handle: typedHandle } = helpers<{ "aliased-ping": [n: number] }>();

export const createAliasedIpc = defineModule("aliased", {
  ping: typedHandle(async (_event, n: number) => n),
  echo: ipcHandle(async (_event, value: string) => value),
});
