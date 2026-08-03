import { defineConfig } from "rollup";

// Electron sandboxes renderers by default, and a sandboxed preload is loaded by a
// CommonJS-only shim with no module resolution: it has to be one self-contained
// .cjs file. `electron` is supplied by that shim, so it stays external.
export default defineConfig({
  input: "./dist/preload.js",
  external: ["electron"],
  output: {
    file: "./dist/preload.cjs",
    format: "cjs",
  },
});
