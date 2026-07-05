import { createIpcHelpers, defineIpcModule } from '../../../../src/runtime/ipc-module.js';

type ItemEvents = {
  'item-updated': [id: string, value: number];
};

const { handle } = createIpcHelpers<ItemEvents>();

export const createEventsIpc = defineIpcModule('events', {
  save: handle(async (event, id: string, value: number) => {
    event.sender.send('item-updated', id, value);
    return true;
  }),
});
