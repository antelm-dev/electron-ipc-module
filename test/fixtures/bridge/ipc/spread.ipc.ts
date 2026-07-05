import { defineIpcModule, handle } from '../../../../src/runtime/ipc-module.js';

const extra = {
  extra: handle(async () => true),
};

export const createSpreadIpc = defineIpcModule('spread', {
  ping: handle(async () => 'pong'),
  ...extra,
});
