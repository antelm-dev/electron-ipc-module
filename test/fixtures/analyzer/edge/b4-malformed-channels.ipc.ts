import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

// B4: a property without `kind` and one with `kind` but without `fn` are
// skipped. Both are type errors, which the analyzer tolerates.
export const malformed = defineIpcModule("malformed", {
  ok: handle(async () => 1),
  // @ts-expect-error no `kind`
  noKind: { fn: () => 1 },
  // @ts-expect-error no `fn`
  noFn: { kind: "handler" },
});
