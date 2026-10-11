import { defineIpcModule } from "../../../../src/runtime/ipc-module.js";

// B12: a stream whose `fn` returns something that is not iterable has no chunk
// type, so the analyzer falls back to `any`. Plain object, no cast.
export const noChunk = defineIpcModule("no-chunk", {
  // @ts-expect-error the stream callback must return an iterable
  broken: { kind: "stream", fn: (_event: unknown) => 1 },
});
