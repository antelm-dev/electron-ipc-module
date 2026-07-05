import { defineIpcModule, handle, listen } from '../../../../src/runtime/ipc-module.js';

export const createDemoIpc = defineIpcModule('demo', {
  ping: handle(async () => 'pong'),
  notify: listen(() => undefined),
  'get-user': handle(async (_event, id: string) => ({ id, name: 'test' })),
});
