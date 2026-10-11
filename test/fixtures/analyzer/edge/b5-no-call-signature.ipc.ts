import { defineIpcModule } from "../../../../src/runtime/ipc-module.js";

// B5: `fn` is not callable, so there is no signature to serialize. Written as
// a plain object (no cast) because no helper can produce this shape.
export const noSignature = defineIpcModule("no-signature", {
  // @ts-expect-error `fn` is not a function
  broken: { kind: "handler", fn: 42 },
});
