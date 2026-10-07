import { defineChannel, defineIpcModule, stream } from "../../../../src/runtime/ipc-module.js";

export const createStreamIpc = defineIpcModule("stream", {
  render: stream(async function* (event, input: string) {
    for (const index of [0, 1]) {
      if (event.signal.aborted) return;
      yield { index, input };
    }
  }),
  lines: stream(function* () {
    yield "line";
  }),
  dates: stream(() => [new Date()]),
  ticks: defineChannel("stream", async function* (_event, count: number) {
    for (let tick = 0; tick < count; tick += 1) yield tick;
  }),
  ping: stream(async function* (): AsyncGenerator<number, void, unknown> {
    yield 1;
  }),
});
