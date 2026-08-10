# electron-ipc-module

[![npm](https://img.shields.io/npm/v/electron-ipc-module?logo=npm)](https://www.npmjs.com/package/electron-ipc-module)
[![CI](https://github.com/antelm-dev/electron-ipc-module/actions/workflows/ci.yml/badge.svg)](https://github.com/antelm-dev/electron-ipc-module/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/electron-ipc-module)](LICENSE)

Modular, type-safe IPC for Electron. Declare handlers in the main process, load them with lifecycle management, and auto-generate a typed preload bridge for the renderer.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Compatibility contract](#compatibility-contract)
- [Quick start](#quick-start)
- [Preload constraints](#preload-constraints)
- [Example](#example)
- [API](#api)
  - [Runtime](#runtime-electron-ipc-module)
  - [Boundaries and caveats](#boundaries-and-caveats)
  - [Error contract](#error-contract)
  - [Intentional public exports](#intentional-public-exports)
  - [Rollup plugin](#rollup-plugin-electron-ipc-modulerollup-plugin)
  - [Generator CLI](#generator-cli)
- [Security model](#security-model)
- [Recommended layout](#recommended-layout)

## Features

- Compact API for `ipcMain.handle`, `handleOnce`, `on`, and `once`
- Automatic channel prefixing (`profile:get`, `profile:save`, …)
- Typed renderer events via `reply`, `sender.send`, and `senderFrame.send`
- Container to load, unload, and observe multiple IPC modules, with channel-collision detection and transactional rollback
- Rollup plugin that generates a typed `ipcRenderer` bridge from `*.ipc.ts` files
- Generated types model the structured clone boundary, so an unserializable payload fails to compile where the channel is declared
- Runtime authorization and payload-validation hooks
- Standalone generate/check/watch CLI

## Installation

```bash
npm install electron-ipc-module
```

**Peer dependencies:** `electron >= 12` and `typescript >= 5 < 7`. The generator, the CLI, and the Rollup plugin load the TypeScript compiler at runtime to analyse your IPC modules, so it is a real requirement rather than a build-time convenience — bundlers that transpile TypeScript without installing the compiler, Vite among them, would otherwise fail at first run. See the [compatibility contract](#compatibility-contract).

## Compatibility contract

- **Modules:** ESM only. Use `import`; CommonJS `require()` is not a supported entry point. This applies to the package itself — your preload output is a separate question, covered in [preload constraints](#preload-constraints).
- **Node.js:** `>=22.5.0`. The floor is not the start of a major line because the generator resolves `ipcDir` with Node's own globbing rather than a dependency: `fs.globSync` arrived in 22.0.0 and `path.matchesGlob` in 22.5.0, and below that a glob `ipcDir` throws. CI runs the packed-artifact job at 22.5.0 exactly — driving the built package with plain Node, including the glob paths that reach both APIs — so the floor is tested rather than merely claimed. The unit matrix runs the latest 22 and 24.
- **Electron:** two different claims, deliberately kept apart.
  - The peer range is `>=12`, an **API-compatibility** claim: nothing here uses an Electron API newer than 12. It is a permissive install-time constraint because npm enforces it, and refusing to install on a version that works helps nobody.
  - **Build/type-checked** support is narrower. CI installs the latest patch of Electron's three currently supported stable majors — 41, 42, and 43 when this contract was frozen — and runs the type check, the public-API check, and the unit suite against each, advancing with [Electron's latest-three-stable support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines). A separate packed-consumer check installs Electron 12.2.3 with TypeScript 5.0.4, generates a bridge, and compiles the public API; majors between 12 and the current support window should work but are not checked individually. Bug reports from that range are welcome and will be treated as real.
  - **The matrix does not launch Electron; one job does.** The unit suite mocks Electron (`test/setup.ts`), so the matrix shows that this package compiles and type-checks against each major — not that IPC behaves identically at runtime on all three. Separately, the `example` job runs [`example/smoke.ts`](./example/smoke.ts) under a real Electron process on the latest supported major: it loads the generated bridge into a sandboxed, context-isolated preload and drives an `invoke`, a `send`, and both main-to-renderer event paths, asserting on the results. That is what proves the generator and the runtime agree on channel names — the one thing a mock cannot show. Structured-clone edge cases beyond those four calls are still covered against the mock only.
- **TypeScript:** `>=5.0.0 <7`, an install-enforced peer dependency. The packed-consumer matrix runs generation and public-API compilation on 5.0.4, the latest 5.x, and 6.x. The generator stack imports `typescript` at runtime for program and type-checker access. TypeScript 7 moved that API off the package's root entry point (`exports["."]` now resolves to `lib/version.cjs`) and behind `typescript/unstable/*`, so it is excluded until the replacement API loses its `unstable` prefix.
- **Package paths:** only `.`, `./rollup-plugin`, and `./generator` are public. Files under `dist/` are implementation details. Only `./rollup-plugin`, `./generator`, and the CLI need `typescript`; the `.` runtime entry does not import it.

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

| Export                                         | Description                                     |
| ---------------------------------------------- | ----------------------------------------------- |
| `defineIpcModule(prefix, channels, options?)`  | Register a group of IPC channels                |
| `createIpcHelpers<TEmit>()`                    | Create typed `handle` / `listen` helpers        |
| `defineIpcEvents<TEvents>()`                   | Declare an emitted-event map for the bridge     |
| `defineChannel(type, fn)`                      | Low-level channel definition behind the helpers |
| `handle`, `handleOnce`, `listen`, `listenOnce` | Default untyped helpers                         |
| `createIpcContainer()`                         | Load, unload, and observe IPC modules           |
| `IpcAuthorizationError`                        | Thrown when `authorize` returns `false`         |
| `IpcValidationError`                           | Thrown when a schema `validate` entry rejects   |
| `IpcChannelCollisionError`                     | Thrown on a duplicate physical channel name     |
| `IpcContainerDisposedError`                    | Thrown by lifecycle calls after `dispose()`     |
| `IpcObserverError`                             | Reported on `error` when an observer threw      |

**Typed events.** Pass an event map to `createIpcHelpers<TEmit>()` to type `event.reply`, `event.sender.send`, and `event.senderFrame?.send`. Emitted events are **not** prefixed by `defineIpcModule`.

Alternatively, declare an event map with `defineIpcEvents<TEvents>()` and export it from the `*.ipc.ts` file. The bridge plugin reads the type argument to generate typed `on<Event>` / `once<Event>` listeners in the renderer — useful when a module emits events without wiring them through `createIpcHelpers`:

```ts
type StatusEvents = { "status-changed": [online: boolean] };
export const statusEvents = defineIpcEvents<StatusEvents>();
// -> bridge.status.onStatusChanged((online) => { ... })
```

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

For `handle` channels, rejected promises propagate back through `ipcRenderer.invoke`. For fire-and-forget `listen` channels, failures are caught and passed to `onListenerError` (or logged) so they never become unhandled rejections.

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

#### Observer exceptions

Observers are notifications, not participants. An exception thrown by a `loaded`, `unloaded`, or `error` listener never changes the outcome of the lifecycle operation that emitted it:

- The operation still resolves or rejects on its own merits, so its result always agrees with `has()`, `names`, and the registered channels. A throwing `loaded` listener cannot leave a rejected `loadAll()` partially committed, and cannot un-commit a successful `load()`.
- An error already in flight is never replaced. A throwing `error` listener cannot mask the registration or cleanup failure it was told about, and a throwing `unloaded` listener cannot swallow an `AggregateError` from a failed cleanup.
- The exception itself is reported on `error`, wrapped in `IpcObserverError` so it is distinguishable from a lifecycle failure. It carries `event`, `moduleName`, and the original `reason`.

One case is terminal and silent by design: an `error` listener that throws while being told about another observer's exception. Re-entering `error` would recurse and there is no other channel, so it is dropped. Keep `error` listeners defensive.

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

#### No cancellation or progress API, by design

There is no `AbortSignal` on the handler context and no streaming channel kind. Doing it properly means per-call correlation IDs, per-call state in the container, and teardown when a window closes — a subsystem, for a problem two IPC channels already solve:

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

Open an issue if you have a case this pattern genuinely cannot cover.

### Error contract

| Failure                | Behavior                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authorization          | `authorize` returning `false` creates `IpcAuthorizationError`. A thrown/rejected authorization error is preserved. Handlers reject; listeners use listener-failure behavior below.                                                                                                                                                                                                                                 |
| Validation             | A callback validator's thrown/rejected value is preserved; a schema reporting issues creates `IpcValidationError` carrying them. The channel callback is not called. Handlers reject; listeners use listener-failure behavior below.                                                                                                                                                                               |
| Handler callback       | A thrown value or rejected promise is preserved and returned through Electron's `invoke` rejection path.                                                                                                                                                                                                                                                                                                           |
| Listener callback      | Synchronous throws and promise rejections are caught. `onListenerError(error, context, event)` is called once, or the error is logged when no hook exists. If the hook itself throws, that secondary error is logged; it is never rethrown into Electron's event emitter.                                                                                                                                          |
| Cleanup                | Every relevant channel cleanup and module cleanup is attempted. State is removed even on failure. One or more failures reject with `AggregateError`; rollback errors are aggregated with the original failure, original error first.                                                                                                                                                                               |
| Registration collision | Electron registration errors are preserved and already-attached channels are rolled back. Container-detected duplicate physical channels reject with `IpcChannelCollisionError`; cleanup failure produces an `AggregateError` containing both errors.                                                                                                                                                              |
| Generator diagnostics  | TypeScript configuration, syntax, and semantic errors and unsafe-to-generate conditions throw `Error` and abort without writing output. Analyzer limitations such as spreads and duplicate event declarations are returned in each module's `warnings` and logged, but generation continues. CLI commands report thrown diagnostics and exit non-zero; `check` also exits non-zero when generated output is stale. |

`load` emits `error` only when an error listener is attached, so Node's special unhandled `error` event cannot mask the rejection. `loaded` is emitted after commit and `unloaded` after state removal. Exceptions thrown by observers are isolated from the lifecycle operation and reported as `IpcObserverError`; see [observer exceptions](#observer-exceptions).

### Intentional public exports

**The root is runtime-only.** It exports the runtime values shown above, `IpcAuthorizationError`, `IpcValidationError`, `IpcChannelCollisionError`, `IpcContainerDisposedError`, and `IpcObserverError`. Its exported types are the callback/event types (`IpcHandler`, `IpcListener`, typed Electron event/sender types), module/container registration types, option/context/validator types, channel definition types, and the general `MaybePromise`, `MethodsOnly`, `Serializable`, `IpcUncloneable`, and `LoggerLike` helpers. These lower-level types are public so wrappers and tooling can describe compatible registrations without importing internal files.

**The generator's own types are not on the root.** `IpcBridgeOptions`, `ResolvedIpcBridgeOptions`, `AnalyzedIpcModule`, `ChannelInfo`, and `EmittedEventInfo` describe how the bridge is _produced_, not what a main-process consumer depends on, so they live on `electron-ipc-module/generator` alongside the functions that return them. Keeping them off the root means the analyzer's output shape can change without that being a breaking change for everyone who only ever imports `defineIpcModule`.

`electron-ipc-module/rollup-plugin` exports the plugin default plus `IpcBridgeOptions` and `LoggerLike` — the same import works in a Vite config, since the plugin implements Vite's compatible plugin API. `electron-ipc-module/generator` exports `resolveIpcBridgeOptions`, `getIpcBridgeWatchTargets`, `isIpcBridgeRelevantFile`, and `runIpcBridgeGeneration`, plus the five types above and `LoggerLike`.

Compile-time API tests import all of this through the built package export map; no public-contract test imports `src`. The moved types are additionally asserted _absent_ from the root, so a barrel re-export cannot quietly widen the surface again.

### Rollup plugin (`electron-ipc-module/rollup-plugin`)

Analyzes `*.ipc.ts` files and generates a typed bridge for the renderer.

| Option     | Default                         | Description                                   |
| ---------- | ------------------------------- | --------------------------------------------- |
| `ipcDir`   | `./src/ipc`                     | Directory or glob of IPC module files         |
| `outFile`  | `./src/generated/ipc-bridge.ts` | Generated TypeScript output                   |
| `tsconfig` | `./tsconfig.json`               | TypeScript config used for static analysis    |
| `logger`   | labelled console logger         | Where progress and analyzer warnings are sent |

`logger` takes any `LoggerLike` — `Pick<Console, "debug" \| "info" \| "warn" \| "error" \| "log">`, exported from the root. Supply one to route generator output into a build tool's own reporter, to silence it in a watch loop, or to see the per-module `debug` detail the default logger drops. The default prints `info` and above; a supplied logger receives every level.

**Naming conventions**

| Source                    | Generated API                          |
| ------------------------- | -------------------------------------- |
| `profile.ipc.ts`          | `bridge.profile`                       |
| channel `"get-all"`       | `bridge.profile.getAll()`              |
| event `"profile-updated"` | `bridge.profile.onProfileUpdated(...)` |

**Static analysis tips**

- Use `*.ipc.ts` file names
- **One `defineIpcModule` per file.** The bridge is grouped into one entry named after the file, so a second module in the same file has nowhere to go. Generation fails rather than emitting the first and dropping the rest, which would register both on `ipcMain` while the renderer only ever saw one.
- Prefer a plain object literal in `defineIpcModule(...)`
- Avoid spreads in the channels object for complete bridge typing
- Use a string literal for the module prefix so build-time and runtime channel names cannot diverge

The plugin also implements Vite's compatible plugin API, so the same `electron-ipc-module/rollup-plugin` import works in a Vite config.

### Generator CLI

The same generator can be used without Rollup:

```bash
npx electron-ipc-module generate \
  --ipc-dir ./main/ipc \
  --out-file ./main/generated/ipc-bridge.ts \
  --tsconfig ./tsconfig.preload.json

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

## License

MIT © [Adel Terki](LICENSE)
