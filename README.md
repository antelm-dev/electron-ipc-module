# electron-ipc-module

[![npm](https://img.shields.io/npm/v/electron-ipc-module?logo=npm)](https://www.npmjs.com/package/electron-ipc-module)
[![CI](https://github.com/antelm-dev/electron-ipc-module/actions/workflows/ci.yml/badge.svg)](https://github.com/antelm-dev/electron-ipc-module/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/electron-ipc-module)](LICENSE)

Modular, type-safe IPC for Electron. Declare handlers in the main process, load them with lifecycle management, and auto-generate a typed preload bridge for the renderer.

## Features

- Compact API for `ipcMain.handle`, `handleOnce`, `on`, and `once`
- Automatic channel prefixing (`profile:get`, `profile:save`, …)
- Typed renderer events via `reply`, `sender.send`, and `senderFrame.send`
- Container to load, unload, and observe multiple IPC modules
- Rollup plugin that generates a typed `ipcRenderer` bridge from `*.ipc.ts` files
- Runtime authorization and payload-validation hooks
- Standalone generate/check/watch CLI

## Installation

```bash
npm install electron-ipc-module
```

**Peer dependency:** `electron >= 41` (see the compatibility contract below)

## 0.1 compatibility contract

- **Modules:** ESM only. Use `import`; CommonJS `require()` is not a supported entry point.
- **Node.js:** Node 20 and every even/odd release from Node 22 onward (`20 || >=22`). CI covers Node 20 and 22.
- **Electron:** the peer range is `>=41` — what CI actually tests, which is the latest patch of Electron's three currently supported stable majors (41, 42, and 43 when this contract was frozen). The matrix advances with [Electron's latest-three-stable support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines). Nothing here uses an API newer than Electron 12, so overriding the peer range to run against an older major will very likely work — it is simply untested, and a claim that broad was more misleading than useful.
- **Package paths:** only `.`, `./rollup-plugin`, and `./generator` are public. Files under `dist/` are implementation details.

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

### 4. Expose the bridge in preload

```ts
import { contextBridge } from "electron";
import { bridge } from "./generated/ipc-bridge";

contextBridge.exposeInMainWorld("ipc", bridge);
```

### 5. Call from the renderer

```ts
const profile = await window.ipc.profile.get("abc-123");
window.ipc.profile.onProfileUpdated((profile) => {
  console.log("updated", profile);
});
```

## Preload constraints

The generated bridge is a preload-side file, and preload scripts have loader rules of their own. They are Electron's rules, not this package's, but they decide how you build the generated file — get them wrong and the preload fails to load with `SyntaxError: Cannot use import statement outside a module` and a renderer whose `window.ipc` is `undefined`.

- **Sandboxed preloads are CommonJS-only.** Electron sandboxes renderers by default since v20. A sandboxed preload runs in a restricted loader with no module resolution: it must be a **single self-contained CommonJS file**. Emitting ESM — which is what `tsc` produces in a `"type": "module"` package — does not work, and neither does splitting the bridge into a separate file the preload imports at runtime. Bundle the preload.
- **`electron` stays external.** The sandbox shim provides `electron` (plus `events`, `timers`, and `url`). Mark it external in your bundler rather than trying to inline it. The generated bridge imports nothing else, so no other module needs resolving.
- **ESM preloads require opting out of the sandbox.** Electron supports an ESM preload only with `sandbox: false` and an `.mjs` extension. That trades a real security boundary for a build convenience — prefer bundling to CJS.
- **`contextIsolation: true` and `nodeIntegration: false`** are assumed by the generated bridge and are the defaults. The runtime does not verify them.

[`example/`](./example) builds its preload this way with `tsc` plus a nine-line Rollup config, and runs under `sandbox: true`.

## Example

[`example/`](./example) is a small, runnable Electron application with one typed IPC module. It shows an invocation, renderer-to-main messages, main-to-renderer events, generated bridge methods, and context-isolated preload exposure.

```bash
cd example
pnpm install
pnpm start
```

## API

### Runtime (`electron-ipc-module`)

| Export                                         | Description                                 |
| ---------------------------------------------- | ------------------------------------------- |
| `defineIpcModule(prefix, channels, options?)`  | Register a group of IPC channels            |
| `createIpcHelpers<TEmit>()`                    | Create typed `handle` / `listen` helpers    |
| `defineIpcEvents<TEvents>()`                   | Declare an emitted-event map for the bridge |
| `handle`, `handleOnce`, `listen`, `listenOnce` | Default untyped helpers                     |
| `createIpcContainer()`                         | Load, unload, and observe IPC modules       |

**`handleOnce` and `listenOnce` are process-scoped, not window-scoped.** `ipcMain` is global, so the first call from _any_ window consumes the channel: later `invoke`s reject with "No handler registered", and later sends are dropped. That is Electron's behavior, not something this package narrows. In a multi-window app use `handle`/`listen` and track one-shot state yourself.

**No cancellation or progress API, by design.** There is no `AbortSignal` on the handler context and no streaming channel kind. Doing it properly means per-call correlation IDs, per-call state in the container, and teardown when a window closes — a subsystem, for a problem two IPC channels already solve:

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
  cancel: listen((_event, jobId: string) => cancelled.add(jobId)),
});
```

Open an issue if you have a case this pattern genuinely cannot cover.

**What survives the boundary.** Electron serializes IPC payloads with the structured clone algorithm, which does not carry JavaScript semantics across intact. The generated bridge wraps every parameter and return type in `Serializable<T>` so the renderer's types describe what it actually receives, not what the main process returned:

| In the main process                                                  | In the renderer                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| Class instance                                                       | Plain object with the own properties; methods `never` |
| Method or function-valued property                                   | `never` — structured clone throws `DataCloneError`    |
| `Date`, `RegExp`, `Map`, `Set`, `Error`, `ArrayBuffer`, typed arrays | Preserved, prototype included                         |
| Getter                                                               | Flattened to the value it evaluated to at send time   |

So a handler returning a `User` class instance gives the renderer `{ id: string; greet: never }` — calling `user.greet()` is a compile error at the call site instead of `undefined is not a function` at runtime. Return plain data, or map to a DTO inside the handler.

`Serializable<T>` is exported from the root if you want it in your own wrappers.

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

**Authorization and runtime validation.** Types protect callers at compile time; these hooks protect the actual main-process boundary. Returning `false` from `authorize` rejects the call with `IpcAuthorizationError`. Validators should throw when a payload is invalid.

```ts
defineIpcModule("profile", channels, {
  authorize: (event) => event.senderFrame?.url.startsWith("app://") === true,
  validate: {
    save: (args) => profileInputSchema.parse(args[0]),
  },
  // listen/listenOnce failures are not returned to the renderer — hook or log them
  onListenerError: (error, context) => {
    console.error(`IPC listener failed on ${context.channel}`, error);
  },
});
```

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

All lifecycle mutations (`load`, `loadAll`, `unload`, `unloadAll`, and `dispose`) are asynchronous and run through one FIFO queue in invocation order. Reads such as `has`, `names`, and `getChannels` report only committed state and do not wait for that queue.

- `load(name, register)` unloads a committed module with the same name before it starts the replacement registration. If replacement fails, the old module stays unloaded.
- `loadAll(entries)` is insert-only and transactional. It rejects before registration if any supplied name is loaded, then registers entries in object iteration order. Its result is `Record<string, string[]>`, preserving each module name. A failure rolls back every earlier entry from that batch.
- `unload(name)` waits for earlier calls, returns `false` for an unknown name, or removes the module and returns `true`.
- `unloadAll()` waits for earlier calls, attempts every loaded module in insertion order, and leaves the container reusable.
- `dispose()` waits for earlier calls, unloads everything, and is terminal and idempotent. Repeated calls return the same result. Other lifecycle calls requested after `dispose()` reject with `IpcContainerDisposedError`; read methods remain available and report the final committed state.
- Physical channel names must be unique across loaded modules, regardless of whether they are handlers or listeners. The incoming registration is cleaned up and rejected with `IpcChannelCollisionError`. Duplicate channels returned within one registration are rejected the same way.

Because the queue is global, overlap has no special race behavior: `load(); unload()` loads and then unloads, two loads replace in call order, and no operation can interleave with a `loadAll` batch or `dispose`.

### Error contract

| Failure                | 0.1 behavior                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authorization          | `authorize` returning `false` creates `IpcAuthorizationError`. A thrown/rejected authorization error is preserved. Handlers reject; listeners use listener-failure behavior below.                                                                                                                                                                                                                                 |
| Validation             | The validator's thrown/rejected value is preserved. The channel callback is not called. Handlers reject; listeners use listener-failure behavior below.                                                                                                                                                                                                                                                            |
| Handler callback       | A thrown value or rejected promise is preserved and returned through Electron's `invoke` rejection path.                                                                                                                                                                                                                                                                                                           |
| Listener callback      | Synchronous throws and promise rejections are caught. `onListenerError(error, context, event)` is called once, or the error is logged when no hook exists. If the hook itself throws, that secondary error is logged; it is never rethrown into Electron's event emitter.                                                                                                                                          |
| Cleanup                | Every relevant channel cleanup and module cleanup is attempted. State is removed even on failure. One or more failures reject with `AggregateError`; rollback errors are aggregated with the original failure, original error first.                                                                                                                                                                               |
| Registration collision | Electron registration errors are preserved and already-attached channels are rolled back. Container-detected duplicate physical channels reject with `IpcChannelCollisionError`; cleanup failure produces an `AggregateError` containing both errors.                                                                                                                                                              |
| Generator diagnostics  | TypeScript configuration, syntax, and semantic errors and unsafe-to-generate conditions throw `Error` and abort without writing output. Analyzer limitations such as spreads and duplicate event declarations are returned in each module's `warnings` and logged, but generation continues. CLI commands report thrown diagnostics and exit non-zero; `check` also exits non-zero when generated output is stale. |

`load` emits `error` only when an error listener is attached, so Node's special unhandled `error` event cannot mask the rejection. `loaded` is emitted after commit and `unloaded` after state removal.

### Intentional public exports

The root export contains the runtime values shown above, `IpcAuthorizationError`, `IpcChannelCollisionError`, and `IpcContainerDisposedError`. Its exported types are the callback/event types (`IpcHandler`, `IpcListener`, typed Electron event/sender types), module/container registration types, option/context types, channel definition types, generator analysis/option types, and the general `MaybePromise`, `MethodsOnly`, `Serializable`, and `LoggerLike` helpers. These lower-level types are public so wrappers and tooling can describe compatible registrations without importing internal files.

The Rollup and Vite paths export the plugin default plus `IpcBridgeOptions`. The generator path exports `resolveIpcBridgeOptions`, `getIpcBridgeWatchTargets`, `isIpcBridgeRelevantFile`, `runIpcBridgeGeneration`, and `IpcBridgeOptions`. Compile-time API tests import all of these through the built package export map; no public-contract test imports `src`.

### Rollup plugin (`electron-ipc-module/rollup-plugin`)

Analyzes `*.ipc.ts` files and generates a typed bridge for the renderer.

| Option     | Default                         | Description                                |
| ---------- | ------------------------------- | ------------------------------------------ |
| `ipcDir`   | `./src/ipc`                     | Directory or glob of IPC module files      |
| `outFile`  | `./src/generated/ipc-bridge.ts` | Generated TypeScript output                |
| `tsconfig` | `./tsconfig.json`               | TypeScript config used for static analysis |

**Naming conventions**

| Source                    | Generated API                          |
| ------------------------- | -------------------------------------- |
| `profile.ipc.ts`          | `bridge.profile`                       |
| channel `"get-all"`       | `bridge.profile.getAll()`              |
| event `"profile-updated"` | `bridge.profile.onProfileUpdated(...)` |

**Static analysis tips**

- Use `*.ipc.ts` file names
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
npx electron-ipc-module check
```

`check` does not write files and exits non-zero when the generated bridge is stale. The programmatic generator is exported from `electron-ipc-module/generator`.

**Commit the generated bridge.** It is the renderer's entire API surface, so keeping it in version control makes every change to it show up in review — a new channel reaching the renderer is exactly the diff a reviewer should see, and it is invisible if the file is generated during the build. It also means a fresh clone type-checks before anyone runs the generator.

Then run `check` in CI to guarantee the committed file matches the `*.ipc.ts` sources:

```yaml
- run: npx electron-ipc-module check
```

`example/generated/ipc-bridge.ts` in this repository follows exactly that convention.

## Security model

- **Context isolation required.** The generated bridge is meant to be exposed via `contextBridge.exposeInMainWorld` in a preload script (see step 4 above); it assumes `contextIsolation: true` and `nodeIntegration: false` on the `BrowserWindow`. The runtime does not check these settings itself.
- **No arbitrary channel exposure.** The bridge is generated statically at build time from the `*.ipc.ts` files found in `ipcDir` — the renderer only ever gets `invoke`/`send` wrappers for channels you explicitly declared with `defineIpcModule`. There is no generic `ipcRenderer.invoke`/`.send`/`.on` passthrough, so the renderer can't reach an arbitrary or future main-process channel.
- **Main process still validates input.** Channel prefixing and typed bridges prevent _name_ collisions and typos, not payload attacks. Use the `authorize` and `validate` hooks (or equivalent checks inside handlers) before touching the filesystem, network, or other privileged APIs.

## Recommended layout

```
main/
  ipc/
    profile.ipc.ts
    settings.ipc.ts
  generated/
    ipc-bridge.ts
  preload.ts
```

## License

MIT © [Adel Terki](LICENSE)
