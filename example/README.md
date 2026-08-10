# Basic Electron example

This is a minimal Electron application with one typed IPC module. It demonstrates:

- `ipcRenderer.invoke` through `window.ipc.greeting.get()`
- fire-and-forget renderer-to-main messages through `set()` and `notify()`
- typed main-to-renderer events with `event.sender.send()` and `event.reply()`
- a generated, context-isolated preload bridge

From this directory, install dependencies and start the application:

```bash
pnpm install
pnpm start
```

`pnpm start` first generates `generated/ipc-bridge.ts`, compiles the TypeScript files into `dist/`, bundles the preload, and opens Electron. The generated bridge is committed so its type-safe API is easy to inspect; regenerate it after changing `ipc/greeting.ipc.ts`.

## The smoke test

```bash
pnpm smoke
```

[`smoke.ts`](./smoke.ts) is the same application with a hidden window and no user: it drives `window.ipc.greeting` through an `invoke`, a `send`, and both main-to-renderer event paths, then exits non-zero if any result is wrong. CI runs it, and it is the only place a real Electron process executes — the unit suite mocks Electron, so nothing else can catch the generator and the runtime disagreeing about a channel name.

Results come back through `webContents.executeJavaScript`, which travels over Chromium's debugger channel rather than over IPC, so the mechanism being tested is not also the one reporting the verdict. Each assertion has a timeout, because a channel-name mismatch shows up as an event that never arrives rather than as an error.

## Why the preload is bundled

The window runs with `sandbox: true` (Electron's default since v20), and a sandboxed preload is loaded by a CommonJS-only shim with no module resolution — it has to be a single self-contained `.cjs` file. `tsc` alone cannot produce one here: this package is `"type": "module"`, so its emitted `.js` is ESM and the preload fails with `SyntaxError: Cannot use import statement outside a module`.

So the build runs in three steps: `generate` writes the bridge, `tsc` compiles everything to ESM in `dist/`, and [`rollup.config.js`](./rollup.config.js) bundles `dist/preload.js` and the generated bridge into `dist/preload.cjs` with `electron` left external. Any bundler does this job — Rollup is used here because it is the smallest config that works.

Main-process code has no such constraint and stays ESM.
