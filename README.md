# electron-ipc-module

[![npm](https://img.shields.io/npm/v/electron-ipc-module?logo=npm)](https://www.npmjs.com/package/electron-ipc-module)
[![CI](https://github.com/antelm-dev/electron-ipc-module/actions/workflows/ci.yml/badge.svg)](https://github.com/antelm-dev/electron-ipc-module/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/electron-ipc-module)](LICENSE)

Modular, type-safe IPC for Electron. Declare handlers in the main process, load them with lifecycle management, and auto-generate a typed preload bridge for the renderer.

## Features

- Compact API for `ipcMain.handle`, `handleOnce`, `on`, and `once`, with automatic channel prefixing (`profile:get`, `profile:save`, …)
- Typed renderer events via `reply`, `sender.send`, and `senderFrame.send`
- Container to load, unload, and observe multiple IPC modules, with channel-collision detection and transactional rollback
- Rollup/Vite plugin that generates a typed `ipcRenderer` bridge from `*.ipc.ts` files
- Generated types model the structured clone boundary, so an unserializable payload fails to compile where the channel is declared
- Runtime authorization and payload-validation hooks, and a standalone generate/check/watch CLI

## Installation

```bash
npm install electron-ipc-module
```

| Requirement | Range                                        |
| ----------- | -------------------------------------------- |
| Node.js     | `>=22.5.0`                                   |
| Electron    | `>=12` peer; majors 41–43 build-tested in CI |
| TypeScript  | `>=5.0.0 <7` peer                            |
| Modules     | ESM only                                     |

`typescript` is a real peer dependency, not a build-time convenience: the generator, the CLI, and the Rollup plugin load the compiler at runtime to analyse your IPC modules, so bundlers that transpile TypeScript without installing it — Vite among them — would otherwise fail at first run.

See [compatibility and stability](./guides/compatibility.md) for what CI actually verifies and the SemVer contract.

## Quick start

### 1. Define an IPC module

```ts
// main/ipc/profile.ipc.ts
import { createIpcHelpers, defineIpcModule } from "electron-ipc-module";

type ProfileEvents = {
  "profile-updated": [profile: { id: string; name: string }];
};

const { handle, listen } = createIpcHelpers<ProfileEvents>();

export function createProfileIpc(service: ProfileService) {
  return defineIpcModule("profile", {
    get: handle((_event, id: string) => service.get(id)),

    save: handle(async (event, input: { id: string; name: string }) => {
      const profile = await service.save(input);
      event.sender.send("profile-updated", profile);
      return profile;
    }),

    "open-editor": listen(() => {
      service.openEditor();
    }),
  });
}
```

This registers:

- `profile:get` → `ipcRenderer.invoke`
- `profile:save` → `ipcRenderer.invoke`
- `profile:open-editor` → `ipcRenderer.send`

Return plain data from handlers. Class instances and functions do not survive the IPC boundary — see [what survives the boundary](#what-survives-the-boundary).

### 2. Load modules in main

```ts
import { createIpcContainer } from "electron-ipc-module";
import { createProfileIpc } from "./ipc/profile.ipc.js";

const ipc = createIpcContainer();

await ipc.loadAll({
  profile: createProfileIpc(profileService),
});
```

### 3. Generate the preload bridge

```js
// rollup.config.js
import ipcBridge from "electron-ipc-module/rollup-plugin";

export default {
  plugins: [
    ipcBridge({
      ipcDir: "./main/ipc",
      outFile: "./main/generated/ipc-bridge.ts",
      tsconfig: "./tsconfig.preload.json",
    }),
  ],
};
```

Commit the generated file — see [generator CLI](#generator-cli) for why, and how to keep it honest in CI.

### 4. Expose the bridge in preload

```ts
// main/preload.ts
import { contextBridge } from "electron";
import { bridge } from "./generated/ipc-bridge.js";

contextBridge.exposeInMainWorld("ipc", bridge);
```

**This file must be built to a single CommonJS file.** Electron sandboxes renderers by default, and a sandboxed preload cannot load ESM or resolve modules. Read [preload constraints](#preload-constraints) before wiring up your build — getting it wrong leaves `window.ipc` undefined at runtime.

### 5. Type `window.ipc` in the renderer

The generated bridge is the single source of truth for the renderer's API, so derive the global from it rather than hand-writing a duplicate:

```ts
// renderer/ipc.d.ts
import type { bridge } from "../main/generated/ipc-bridge.js";

declare global {
  interface Window {
    ipc: typeof bridge;
  }
}
```

Both of these are boilerplate the generator can write instead — see [`expose`](#exposing-the-bridge-automatically).

### 6. Call from the renderer

```ts
const profile = await window.ipc.profile.get("abc-123");
window.ipc.profile.onProfileUpdated((profile) => {
  console.log("updated", profile);
});
```

`onProfileUpdated` returns an unsubscribe function — call it when the component unmounts.

## Preload constraints

The generated bridge is a preload-side file, and preload scripts have loader rules of their own. They are Electron's rules, not this package's, but they decide how you build the generated file. Get them wrong and the preload fails to load with `SyntaxError: Cannot use import statement outside a module`, leaving a renderer whose `window.ipc` is `undefined`.

- **Sandboxed preloads are CommonJS-only.** Electron sandboxes renderers by default since v20. A sandboxed preload runs in a restricted loader with no module resolution: it must be a **single self-contained CommonJS file**. Emitting ESM — which is what `tsc` produces in a `"type": "module"` package — does not work, and neither does splitting the bridge into a separate file the preload imports at runtime. Bundle the preload.
- **`electron` stays external.** The sandbox shim provides `electron` (plus `events`, `timers`, and `url`). Mark it external in your bundler rather than trying to inline it. The generated bridge imports nothing else at runtime — its `Serializable` import is type-only and erased at build time — so no other module needs resolving.
- **ESM preloads require opting out of the sandbox.** Electron supports an ESM preload only with `sandbox: false` and an `.mjs` extension. That trades a real security boundary for a build convenience — prefer bundling to CommonJS.
- **`contextIsolation: true` and `nodeIntegration: false`** are assumed by the generated bridge and are the defaults. The runtime does not verify them; see [security model](#security-model).

[`example/`](./example) builds its preload exactly this way — `tsc` for compilation, then a small [Rollup config](./example/rollup.config.js) to bundle — and runs under `sandbox: true`.

## Example

[`example/`](./example) is a small, runnable Electron application with one typed IPC module. It shows an invocation, renderer-to-main messages, main-to-renderer events, generated bridge methods, and context-isolated preload exposure.

```bash
cd example
pnpm install
pnpm start
```

## API

### Runtime (`electron-ipc-module`)

| Export                                        | Description                                                          |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `defineIpcModule(prefix, channels, options?)` | Register a group of IPC channels                                     |
| `createIpcEmitter<TEvents>(source?)`          | Send typed events from independent main-process producers            |
| `createIpcHelpers<TEmit>()`                   | Create typed `handle` / `listen` helpers                             |
| `defineIpcEvents<TEvents>()`                  | Declare an emitted-event map for the bridge                          |
| `defineChannel(type, fn)`                     | Extension point for wrapper authors; prefer the preset helpers       |
| `handle`, `listen`                            | Default untyped helpers                                              |
| `handleOnce`, `listenOnce`                    | Process-scoped one-shot helpers; the first call from any window wins |
| `createIpcContainer()`                        | Load, unload, and observe IPC modules                                |
| `IpcAuthorizationError`                       | Thrown when `authorize` returns `false`                              |
| `IpcValidationError`                          | Thrown when a schema `validate` entry rejects                        |
| `IpcChannelCollisionError`                    | Thrown on a duplicate physical channel name                          |
| `IpcContainerDisposedError`                   | Thrown by lifecycle calls after `dispose()`                          |
| `IpcObserverError`                            | Reported on `error` when an observer threw                           |

The exported types, and why the generator's types live on a separate entry point, are documented in [compatibility and stability](./guides/compatibility.md#where-the-public-types-live).

**Typed events.** Pass an event map to `createIpcHelpers<TEmit>()` to type `event.reply`, `event.sender.send`, and `event.senderFrame?.send`. Emitted events are **not** prefixed by `defineIpcModule`.

Alternatively, declare an event map with `defineIpcEvents<TEvents>()` and export it from the `*.ipc.ts` file. The bridge plugin reads the type argument to generate typed `on<Event>` / `once<Event>` listeners in the renderer — useful when a module emits events without wiring them through `createIpcHelpers`:

```ts
type StatusEvents = { "status-changed": [online: boolean] };
export const statusEvents = defineIpcEvents<StatusEvents>();
// -> bridge.status.onStatusChanged((online) => { ... })
```

For timers, jobs, file watchers, and other producers that run independently of
an incoming IPC call, pair a module event declaration with a standalone
emitter. The module declaration is what lets bridge generation create the
renderer listener:

```ts
// jobs.ipc.ts
import { defineIpcEvents, defineIpcModule } from "electron-ipc-module";

export type JobEvents = { "job-completed": [jobId: string] };
const channels = {};

export const registerJobsIpc = defineIpcModule("jobs", channels, { eventPrefix: true });
export const jobEvents = defineIpcEvents<JobEvents>();
// -> bridge.jobs.onJobCompleted((jobId) => { ... })
```

The independent producer takes its prefix from the module itself:

```ts
// jobs-producer.ts
import { createIpcEmitter } from "electron-ipc-module";
import { registerJobsIpc, type JobEvents } from "./jobs.ipc.js";

const jobs = createIpcEmitter<JobEvents>(registerJobsIpc);

setInterval(() => jobs.emit("job-completed", "nightly-report"), 60_000);
// sends `jobs:job-completed` to every live window

// Send only to one renderer.
jobs.emitTo(window.webContents, "job-completed", "on-demand-report");
```

Standalone emitters do not declare bridge listeners. Export
`defineIpcEvents<TEvents>()` from the corresponding `*.ipc.ts` module so the
bridge generates the matching `on*` / `once*` helpers.

Passing the register function takes that module's own resolved `eventPrefix`,
so renaming it cannot leave the emitter sending to a channel the bridge no
longer listens on. A literal prefix — `createIpcEmitter<JobEvents>("jobs")` —
still works for producers with no module to point at, but has to be kept in
step by hand.

`emit` reaches **every** window, hidden ones included, with no filtering, so do
not broadcast payloads that only one renderer should see. Both methods ignore
destroyed `webContents`, and `emitTo` accepts a handler's `event.sender`
without prefixing the channel twice.

**Cleanup.** `defineIpcModule` accepts an optional `ready` hook. If registration fails, already-registered channels are rolled back automatically.

```ts
defineIpcModule("profile", channels, {
  ready: async (ipc) => {
    return () => {
      // optional module cleanup on unload
    };
  },
});
```

**Authorization and runtime validation.** Types protect callers at compile time; these hooks protect the actual main-process boundary. Returning `false` from `authorize` rejects the call with `IpcAuthorizationError`.

A `validate` entry is either a callback that throws to reject the payload, or any [Standard Schema](https://standardschema.dev) — Zod, Valibot, ArkType, and others implement it, and the package depends only on `@standard-schema/spec`, which is types with no runtime. A schema receives the full argument array and its **parsed output replaces the arguments** the channel callback receives, so coercion carries through instead of being validated and then discarded. Failures reject with `IpcValidationError`, which carries the schema's `issues`.

`validate` keys are checked against the channels you declared, and a schema's output is checked against the channel callback's parameters — so a renamed channel or a schema that drifts from its handler is a compile error, not a guard that silently stops matching.

```ts
defineIpcModule("profile", channels, {
  authorize: (event) => event.senderFrame?.url.startsWith("app://") === true,
  validate: {
    // A schema: `save` is called with the parsed tuple.
    save: z.tuple([profileInputSchema]),
    // Or a callback, when a check needs the event or the channel context.
    rename: (args, event) => {
      if (typeof args[0] !== "string") throw new TypeError("expected a name");
    },
  },
  // listen/listenOnce failures are not returned to the renderer — hook or log them
  onListenerError: (error, context) => {
    console.error(`IPC listener failed on ${context.channel}`, error);
  },
});
```

Callback validators only inspect the original arguments: their return value is discarded. Standard Schema validators are different—their parsed output replaces the callback arguments, so coercion and field stripping carry through to the handler.

For `handle` channels, rejected promises propagate back through `ipcRenderer.invoke`. For fire-and-forget `listen` channels, failures are caught and passed to `onListenerError` (or logged) so they never become unhandled rejections. The full per-stage behavior is in the [error contract](./guides/error-contract.md).

**Event namespacing.** Set `eventPrefix: true` to turn emitted event channels such as `updated` into `profile:updated`. The generated API remains `bridge.profile.onUpdated(...)`. A string may be supplied for a custom physical prefix.

```ts
defineIpcModule("profile", channels, { eventPrefix: true });
```

**Container.**

```ts
const ipc = createIpcContainer();

await ipc.load("profile", createProfileIpc(service));
await ipc.loadAll({ profile, settings });

ipc.on("loaded", (name, channels) => {});
ipc.on("unloaded", (name) => {});
ipc.on("error", (name, error) => {});

await ipc.unload("profile");
await ipc.unloadAll();
```

Reads: `has(name)`, `getChannels(name)`, and the `names`, `allChannels`, and `size` getters.

All lifecycle mutations (`load`, `loadAll`, `unload`, `unloadAll`, and `dispose`) are asynchronous and run through one FIFO queue in invocation order. Reads report only committed state and do not wait for that queue.

- `load(name, register)` unloads a committed module with the same name before it starts the replacement registration. If replacement fails, the old module stays unloaded.
- `loadAll(entries)` is insert-only and transactional. It rejects before registration if any supplied name is loaded, then registers entries in object iteration order. Its result is `Record<string, string[]>`, preserving each module name. A failure rolls back every earlier entry from that batch.
- `unload(name)` waits for earlier calls, returns `false` for an unknown name, or removes the module and returns `true`.
- `unloadAll()` waits for earlier calls, attempts every loaded module in insertion order, and leaves the container reusable.
- `dispose()` waits for earlier calls, unloads everything, and is terminal and idempotent. Repeated calls return the same result. Other lifecycle calls requested after `dispose()` reject with `IpcContainerDisposedError`; read methods remain available and report the final committed state.
- Physical channel names must be unique across loaded modules, regardless of whether they are handlers or listeners. The incoming registration is cleaned up and rejected with `IpcChannelCollisionError`. Duplicate channels returned within one registration are rejected the same way.

Because the queue is global, overlap has no special race behavior: `load(); unload()` loads and then unloads, two loads replace in call order, and no operation can interleave with a `loadAll` batch or `dispose`.

Exceptions thrown by `loaded`, `unloaded`, or `error` listeners are isolated from the lifecycle operation and reported as `IpcObserverError` — see [observer exceptions](./guides/error-contract.md#observer-exceptions).

### Boundaries and caveats

Three things that are Electron's behavior rather than this package's, and are worth knowing before you design around them.

#### What survives the boundary

Electron serializes IPC payloads with the structured clone algorithm, which does not carry JavaScript semantics across intact. The generated bridge wraps every parameter and return type in `Serializable<T>` so the renderer's types describe what it actually receives, not what the main process returned:

| In the main process                                                  | In the renderer                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Function, symbol, `Promise`, `WeakMap`, `WeakSet` — anywhere inside  | Nothing: the **whole payload** is rejected                  |
| Class instance carrying methods                                      | Nothing: rejected, because the type cannot prove it is safe |
| Class instance with only data                                        | Plain object; `instanceof` is false                         |
| `Buffer`                                                             | `Uint8Array` — Electron converts it                         |
| Subclass of `Error`, `Date`, or a typed array                        | The base type, without added fields or methods              |
| `Date`, `RegExp`, `Map`, `Set`, `Error`, `ArrayBuffer`, typed arrays | Preserved, prototype included                               |
| Getter                                                               | Flattened to the value it evaluated to at send time         |

**Rejection is all-or-nothing.** Structured clone does not drop the offending member and deliver the rest — it throws `DataCloneError` and the `invoke()` rejects before any result arrives. So `Serializable<T>` resolves to `IpcUncloneable<T>` for the entire payload rather than mapping one property to `never`. That propagates out of arrays, tuples, `Map`, `Set`, and nested objects, and a union is only as cloneable as its least cloneable member.

The check runs where you declare the channel, not only in the generated bridge:

```ts
class Session {
  constructor(public id: string) {}
  isExpired(): boolean {
    return false;
  }
}

defineIpcModule("session", {
  // Type 'IpcUncloneable<Session>' is not assignable to type 'ChannelDef'.
  current: handle(async (): Promise<Session> => new Session("s1")),
});
```

Return plain data, or map to a DTO inside the handler. Arguments are checked the same way in both directions; a `listen` callback's _return_ value is exempt, since it is never sent back.

A class with methods is rejected even though a prototype method would in fact be dropped silently rather than throwing — a type cannot distinguish an own function property from a prototype one, and the safe reading is the one that never surprises you at runtime.

`Serializable<T>` and `IpcUncloneable<T>` are exported from the root if you want them in your own wrappers.

#### `handleOnce` and `listenOnce` are process-scoped

`ipcMain` is global, so the first call from _any_ window consumes the channel: later `invoke`s reject with "No handler registered", and later sends are dropped silently. In a multi-window app use `handle`/`listen` and track one-shot state yourself.

#### Cancellation and progress

There is no renderer-facing cancellation or streaming channel kind. Use a second IPC channel for explicit user intent, such as a Cancel button, and send progress as typed events:

```ts
// main
const cancelled = new Set<string>();

defineIpcModule("export", {
  start: handle(async (event, jobId: string) => {
    for (const chunk of chunks) {
      if (cancelled.has(jobId)) return { cancelled: true };
      event.sender.send("export-progress", jobId, chunk.index / chunks.length);
    }
    return { cancelled: false };
  }),
  cancel: listen((_event, jobId: string) => {
    cancelled.add(jobId);
  }),
});
```

Sending to a window that has closed is safe on its own: `event.sender.send`, `event.senderFrame?.send`, and `event.reply` all drop the event once the target is destroyed, rather than throwing `Object has been destroyed` in main. An invoke that outlives its caller settles normally.

That keeps the process alive; it does not stop the work. Invoke handlers also receive `event.signal`, which represents the lifetime of the `WebContents` that made the call. It starts active and aborts once that window (or other `WebContents`) is destroyed. Check it before expensive work so a closed window does not leave a job running:

```ts
defineIpcModule("export", {
  start: handle(async (event, jobId: string) => {
    for (const chunk of chunks) {
      if (event.signal.aborted) return { cancelled: true };
      const result = await renderChunk(chunk);
      if (event.signal.aborted) return { cancelled: true };
      event.sender.send("export-progress", jobId, result);
    }
    return { cancelled: false };
  }),
});
```

The signal is cooperative: aborting it does not terminate the handler, select an error, or settle the renderer promise automatically. It tracks destruction of the `WebContents` and nothing else — a reload or an in-place navigation abandons the pending invocation without aborting, because the `WebContents` itself survives. One read-only signal is shared by every invocation from the same sender, and it stays valid after the handler settles. It is built the first time a handler reads it, so it needs a global `AbortController` — Electron 15 or newer; reading it on an older runtime throws, while handlers that never touch it keep working on the package's Electron 12 peer floor. Use the two-channel pattern above when cancellation must also work while the renderer is still alive.

### Rollup plugin (`electron-ipc-module/rollup-plugin`)

Analyzes `*.ipc.ts` files and generates a typed bridge for the renderer.

| Option     | Default                         | Description                                   |
| ---------- | ------------------------------- | --------------------------------------------- |
| `ipcDir`   | `./src/ipc`                     | Directory or glob of IPC module files         |
| `outFile`  | `./src/generated/ipc-bridge.ts` | Generated TypeScript output                   |
| `tsconfig` | `./tsconfig.json`               | TypeScript config used for static analysis    |
| `logger`   | labelled console logger         | Where progress and analyzer warnings are sent |
| `expose`   | not set                         | Global key to expose the bridge under         |

`logger` takes any `LoggerLike` — `Pick<Console, "debug" \| "info" \| "warn" \| "error" \| "log">`, exported from the root. Supply one to route generator output into a build tool's own reporter, to silence it in a watch loop, or to see the per-module `debug` detail the default logger drops. The default prints `info` and above; a supplied logger receives every level.

**Exposing the bridge automatically**

Set `expose` to have the generator write [step 4](#4-expose-the-bridge-in-preload) and [step 5](#5-type-windowipc-in-the-renderer) for you:

```ts
ipcBridge({ expose: "ipc" });
```

The generated file then imports `contextBridge`, ends with `contextBridge.exposeInMainWorld("ipc", bridge)`, and declares `Window["ipc"]` as `typeof bridge`. Both come from the one key, so the exposed name and the type the renderer sees cannot drift apart — a mismatch that still type-checks and shows up only as an undefined `window.ipc` at runtime.

Two things to keep in mind:

- The renderer's tsconfig must **include the generated file** for the `Window` declaration to reach it. Nothing else changes: the file is still a preload artifact and still has to be bundled per the [preload constraints](#preload-constraints).
- `check` compares against what the current options produce, so pass `--expose` there too or CI reports the committed bridge as stale.

The key has to be a new global identifier: `ipc` is fine, while `my-ipc`, `name`, `innerWidth`, and other names declared by the installed TypeScript DOM/ES libraries fail generation. Electron also rejects any runtime-specific global rather than overwriting it.

Leave `expose` unset to keep exposing the bridge yourself — useful when the preload wraps or filters it before handing it to the renderer.

**Naming conventions**

| Source                    | Generated API                          |
| ------------------------- | -------------------------------------- |
| `profile.ipc.ts`          | `bridge.profile`                       |
| channel `"get-all"`       | `bridge.profile.getAll()`              |
| event `"profile-updated"` | `bridge.profile.onProfileUpdated(...)` |

**What gets type-checked**

The generator reads types from the compiler, so a broken type in an IPC source — or in anything it imports — could put a wrong signature in the bridge. Those errors abort generation, and nothing is written.

Errors anywhere else in the `tsconfig` project are ignored. They cannot reach the bridge, and failing on them would mean the half-written file you are in the middle of stops the build with an error from the bridge generator. Point `tsconfig` at your application's config if that is convenient; scoping it to the IPC sources is no longer needed to keep generation quiet.

Configuration and compiler-option errors still abort, since those describe the project rather than any one file.

**Static analysis tips**

- Use `*.ipc.ts` file names
- **One `defineIpcModule` per file.** The bridge is grouped into one entry named after the file, so a second module in the same file has nowhere to go. Generation fails rather than emitting the first and dropping the rest, which would register both on `ipcMain` while the renderer only ever saw one.
- Prefer a plain object literal in `defineIpcModule(...)`
- Avoid spreads in the channels object for complete bridge typing
- Use a string literal for the module prefix so build-time and runtime channel names cannot diverge

The plugin also implements Vite's compatible plugin API, so the same `electron-ipc-module/rollup-plugin` import works in a Vite config.

#### Using with electron-vite

Scaffold a project — the template picker covers React, Vue, Svelte, Solid, and vanilla, in JS or TS:

```bash
npm create @quick-start/electron@latest
```

Then add the plugin to the **preload** build. The bridge is a preload artifact, so putting it under `renderer` generates nothing useful:

```ts
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import ipcBridge from "electron-ipc-module/rollup-plugin";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: {
    plugins: [
      externalizeDepsPlugin(),
      ipcBridge({
        ipcDir: "src/main/ipc",
        outFile: "src/preload/generated/ipc-bridge.ts",
        tsconfig: "tsconfig.node.json",
      }),
    ],
  },
  renderer: {/* your framework plugin */},
});
```

Point `tsconfig` at `tsconfig.node.json`, not the root `tsconfig.json`: the scaffold's root config is a solution file with `"files": []`, so the generator would find no IPC sources to analyse.

`electron-vite dev` regenerates the bridge when a `*.ipc.ts` file changes. This needs `electron-ipc-module@>=1.0.2` — earlier versions registered only the IPC _directory_ as a watch target, and Vite's build watcher ignores directories passed to `addWatchFile`, so the bridge generated once and then went stale until the next cold start. Creating a _new_ `*.ipc.ts` file is still only picked up on the next start of `dev`.

### Generator CLI

The same generator can be used without Rollup:

```bash
npx electron-ipc-module generate \
  --ipc-dir ./main/ipc \
  --out-file ./main/generated/ipc-bridge.ts \
  --tsconfig ./tsconfig.preload.json

npx electron-ipc-module generate --expose ipc
npx electron-ipc-module generate --watch
npx electron-ipc-module generate --quiet
npx electron-ipc-module check
```

`check` does not write files and exits non-zero when the generated bridge is stale. `--quiet` drops progress output while still printing analyzer warnings and errors — a warning means the generated bridge is incompletely typed, which is not the kind of thing a quiet flag should hide. The programmatic generator is exported from `electron-ipc-module/generator`.

**Commit the generated bridge.** It is the renderer's entire API surface, so keeping it in version control makes every change to it show up in review — a new channel reaching the renderer is exactly the diff a reviewer should see, and it is invisible if the file is produced during the build. It also means a fresh clone type-checks before anyone runs the generator.

Then run `check` in CI to guarantee the committed file still matches the `*.ipc.ts` sources:

```yaml
- run: npx electron-ipc-module check
```

[`example/generated/ipc-bridge.ts`](./example/generated/ipc-bridge.ts) follows exactly that convention.

## Security model

- **Context isolation required.** The generated bridge is meant to be exposed via `contextBridge.exposeInMainWorld` in a preload script (see [step 4](#4-expose-the-bridge-in-preload)); it assumes `contextIsolation: true` and `nodeIntegration: false` on the `BrowserWindow`. The runtime does not check these settings itself.
- **Keep the sandbox on.** `sandbox: true` is the default and the [preload constraints](#preload-constraints) are written around keeping it that way. Disabling it to avoid bundling your preload trades a process-level security boundary for a build shortcut.
- **No arbitrary channel exposure.** The bridge is generated statically at build time from the `*.ipc.ts` files found in `ipcDir` — the renderer only ever gets `invoke`/`send` wrappers for channels you explicitly declared with `defineIpcModule`. There is no generic `ipcRenderer.invoke`/`.send`/`.on` passthrough, so the renderer cannot reach an arbitrary or future main-process channel.
- **Main process still validates input.** Channel prefixing and typed bridges prevent _name_ collisions and typos, not payload attacks. Types are erased at runtime and a compromised renderer can send anything to a declared channel. Use the `authorize` and `validate` hooks (or equivalent checks inside handlers) before touching the filesystem, network, or other privileged APIs.

[`SECURITY.md`](./SECURITY.md) records what counts as a vulnerability here and how to report one privately.

## Recommended layout

```
main/
  ipc/
    profile.ipc.ts
    settings.ipc.ts
  generated/
    ipc-bridge.ts     # generated, committed, verified by `check` in CI
  main.ts
  preload.ts          # bundled to a single CommonJS file — see preload constraints
renderer/
  ipc.d.ts            # declares window.ipc from `typeof bridge`
```

## Further reading

- [Renderer patterns](./guides/renderer-patterns.md) — bind subscriptions to view lifetime, hold invoke state, and keep the bridge an allowlist
- [Testing IPC modules](./guides/testing.md) — unit-test registrations and guards, verify generated bridges in CI, and add a real-Electron smoke test
- [Migrating from raw Electron IPC](./guides/migration-from-electron-ipc.md) — convert handlers, preload wrappers, renderer types, and emitted events incrementally
- [Securing IPC channels](./guides/security.md) — authorize senders, validate runtime payloads, route sensitive events, and review privileged channels
- [Build and preload troubleshooting](./guides/build-and-preload-troubleshooting.md) — diagnose preload formats, missing modules, stale output, renderer typing, and watch mode
- [Multi-window and background-work patterns](./guides/multi-window-and-background-work.md) — scope one-shot channels, target events, report progress, and cancel work safely
- [Module architecture and lifecycle](./guides/module-lifecycle.md) — structure modules, inject services, replace registrations, and shut down cleanly
- [Diagnostics reference](./guides/diagnostics.md) — every generator, type, runtime, and CLI message, with its cause and fix
- [Compatibility and stability](./guides/compatibility.md) — supported versions, what CI verifies, the SemVer contract, and where the public types live
- [Error contract](./guides/error-contract.md) — per-stage failure behavior and observer exception isolation
- [Changelog](./CHANGELOG.md)
- [Contributing](./CONTRIBUTING.md)

## License

MIT © [Adel Terki](LICENSE)
