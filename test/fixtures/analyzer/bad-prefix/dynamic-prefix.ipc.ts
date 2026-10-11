import { defineIpcModule, handle } from "../../../../src/runtime/ipc-module.js";

// B1: the prefix is a parameter, not a string literal, so the bridge cannot
// know the runtime channel name and the analyzer must reject it.
export function createDynamicPrefixIpc(prefix: string) {
  return defineIpcModule(prefix, { ping: handle(async () => "pong") });
}
