import { defineIpcModule } from "../../../../src/runtime/ipc-module.js";

// B11: a default value makes the parameter optional. The handler helpers type
// `fn` with a rest tuple, which takes the rest path instead, so a plain channel
// object is the only way to reach the named-parameter path.
export const defaults = defineIpcModule("defaults", {
  // @ts-expect-error not a channel built by a helper
  withDefault: {
    kind: "handler",
    fn: (_event: unknown, label: string, count: number = 1) => count,
  },
});
