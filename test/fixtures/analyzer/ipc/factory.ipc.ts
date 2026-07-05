import { defineIpcModule, handle } from '../../../../src/runtime/ipc-module.js';

export function createFactoryIpc(service: { ping: () => string }) {
  return defineIpcModule('factory', {
    ping: handle(async () => service.ping()),
  });
}
