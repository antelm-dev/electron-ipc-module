import {
  defineIpcModule,
  handle,
  handleOnce,
  listen,
  listenOnce,
} from "../../../../src/runtime/ipc-module.js";

export const createChannelTypesIpc = defineIpcModule("channels", {
  onceHandle: handleOnce(async () => "once"),
  onceListen: listenOnce(() => undefined),
  regularHandle: handle(async () => "ok"),
  regularListen: listen(() => undefined),
});
