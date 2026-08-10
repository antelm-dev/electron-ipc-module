export * from "./runtime/ipc-container.js";
export * from "./runtime/ipc-module.js";
// Runtime types only. The generator's analysis and option types live behind
// `electron-ipc-module/generator`, so changing them is not a change to the
// surface a main-process consumer depends on.
export type * from "./shared/types/runtime.js";
