import { defineIpcEvents, defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

type Events = { "never-listed": [n: number] };

// B10: only `export const name = defineIpcEvents<…>()` counts. Each of these
// is ignored: not exported, destructured, no initializer, and not a variable.
const notExported = defineIpcEvents<Events>();
export const { "never-listed": destructured } = defineIpcEvents<Events>();
export let uninitialized: Events;
export function exportedFunction() {
  return notExported;
}

export const ignoredEvents = defineIpcModule("ignored-events", { ping: handle(async () => 1) });
void destructured;
