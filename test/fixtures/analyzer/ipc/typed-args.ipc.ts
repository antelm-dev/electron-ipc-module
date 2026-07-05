import { defineIpcModule, handle } from '../../../../src/runtime/ipc-module.js';

export const createTypedArgsIpc = defineIpcModule('typed', {
  optional: handle(async (_event, id: string, label?: string) => ({
    id,
    label,
  })),
  rest: handle(async (_event, ...parts: string[]) => parts.join('-')),
  asyncReturn: handle(async () => ({ done: true })),
});
