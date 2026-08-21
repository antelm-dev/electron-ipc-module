---
title: Build and preload troubleshooting
---

# Build and preload troubleshooting

The generated bridge runs in the preload, not in the renderer. Most setup
failures come from generating it in the wrong build, compiling it with the
wrong TypeScript project, or loading an unbundled preload in Electron's
sandbox.

## Known-good build shape

1. Generate `ipc-bridge.ts` from the main-process `*.ipc.ts` files.
2. Compile the application.
3. Bundle the preload and generated bridge into one CommonJS file.
4. Leave `electron` external to that bundle.
5. Load that file as the window's `preload`.
6. Include the generated TypeScript file in the renderer type-checking project.

Commit the generated source and run `electron-ipc-module check` in CI. It makes
bridge changes reviewable and lets a fresh clone type-check before generation.

## `window.ipc` is undefined

Check the earliest failure first:

- Open the preload console and look for a syntax or module-resolution error.
- Confirm the `BrowserWindow` points at the built preload, not its TypeScript
  source or a stale output path.
- Confirm `contextBridge.exposeInMainWorld` ran with the same key used by the
  renderer.
- If using the generator's `expose` option, confirm the current generated file
  contains both the exposure call and the global declaration.
- Verify the generated file was included in the preload bundle.

A sandboxed preload cannot load ESM or resolve arbitrary packages. It must be a
single self-contained CommonJS file. `tsc` output alone is usually insufficient
inside a `"type": "module"` package because its `.js` output remains ESM.

## `Cannot use import statement outside a module`

The sandbox's preload loader received ESM. Bundle the preload to CommonJS
instead of renaming the output. A Rollup configuration can be as small as:

```js
export default {
  input: "dist/preload.js",
  external: ["electron"],
  output: { file: "dist/preload.cjs", format: "cjs", inlineDynamicImports: true },
};
```

An ESM preload requires `sandbox: false` and an `.mjs` extension. Prefer
keeping the sandbox and bundling to CommonJS.

## Generation finds no modules

Verify all of the following:

- IPC source files end in `*.ipc.ts`; test files containing `.test.` are
  intentionally ignored.
- `ipcDir` resolves from the build process's working directory and selects the
  expected files.
- `tsconfig` is an application config that includes those files. A solution
  config with `"files": []` is not enough.
- Each file contains one imported `defineIpcModule` call with a string-literal
  prefix and preferably a plain channel object literal.
- The file and everything its exported channel types depend on type-check.

Use a supplied `logger` when you need debug-level per-module output. Analyzer
warnings mean part of the bridge could not be typed completely and are not
suppressed by the CLI's `--quiet` flag.

## Renderer types do not see the bridge

With `expose: "ipc"`, the generated file declares `Window.ipc`. The renderer's
TypeScript project still has to include that file. Check `include`, `files`, and
project references, then restart the editor's TypeScript server after changing
the project graph.

Without `expose`, derive the declaration instead of duplicating signatures:

```ts
import type { bridge } from "../main/generated/ipc-bridge.js";

declare global {
  interface Window {
    ipc: typeof bridge;
  }
}
```

## The committed bridge is stale

Regenerate with exactly the same options used by `check`. The `expose` key,
`ipcDir`, `outFile`, and `tsconfig` all affect the expected output.

```bash
npx electron-ipc-module generate \
  --ipc-dir ./main/ipc \
  --out-file ./main/generated/ipc-bridge.ts \
  --tsconfig ./tsconfig.preload.json \
  --expose ipc

npx electron-ipc-module check \
  --ipc-dir ./main/ipc \
  --out-file ./main/generated/ipc-bridge.ts \
  --tsconfig ./tsconfig.preload.json \
  --expose ipc
```

Put the shared arguments in package scripts so local generation and CI cannot
drift.

## Watch mode does not regenerate

Use `generate --watch` when no build plugin owns the watch lifecycle. With
Rollup or Vite, put `electron-ipc-module/rollup-plugin` in the **preload** build.
Editing an existing `*.ipc.ts` file should regenerate the bridge. Depending on
the build tool, adding a brand-new IPC file may require restarting watch mode so
the new file enters its graph.

If a monorepo runner changes the working directory, use explicit paths or run
the command from the package that owns the IPC files.

## Generated names are surprising

The file name selects the generated module property, while kebab-case channels
and events become camel-cased methods:

| Source                  | Generated API                       |
| ----------------------- | ----------------------------------- |
| `profile.ipc.ts`        | `bridge.profile`                    |
| `get-all`               | `bridge.profile.getAll()`           |
| event `profile-updated` | `bridge.profile.onProfileUpdated()` |

Keep one module per file. A second `defineIpcModule` call has no unambiguous
generated property and causes generation to fail rather than silently dropping
an API.

## Production verification

Run a smoke test against the packaged preload, not only a development server.
Open a sandboxed, context-isolated hidden window and exercise an invoke, a send,
and an emitted event. This catches output-path mistakes, missing files, format
errors, and runtime/generator channel drift that TypeScript and mocked tests
cannot observe.
