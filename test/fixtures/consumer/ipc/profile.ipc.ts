import { defineIpcEvents, defineIpcModule, handle } from "electron-ipc-module";

export const profileEvents = defineIpcEvents<{
  updated: [profile: { id: string }];
}>();

export default defineIpcModule("profile", {
  get: handle((_event, id: string) => ({ id })),
});
