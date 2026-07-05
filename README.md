# electron-ipc-module

Modular, type-safe IPC for Electron. Declare handlers in the main process, load them with lifecycle management, and auto-generate a typed preload bridge for the renderer.

## Features

- Compact API for `ipcMain.handle`, `handleOnce`, `on`, and `once`
- Automatic channel prefixing (`profile:get`, `profile:save`, …)
- Typed renderer events via `reply`, `sender.send`, and `senderFrame.send`
- Container to load, unload, and observe multiple IPC modules
- Rollup plugin that generates a typed `ipcRenderer` bridge from `*.ipc.ts` files

## Installation

```bash
npm install electron-ipc-module
```

**Peer dependency:** `electron >= 40`

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

## API

### Runtime (`electron-ipc-module`)

| Export | Description |
| --- | --- |
| `defineIpcModule(prefix, channels, options?)` | Register a group of IPC channels |
| `createIpcHelpers<TEmit>()` | Create typed `handle` / `listen` helpers |
| `handle`, `handleOnce`, `listen`, `listenOnce` | Default untyped helpers |
| `createIpcContainer()` | Load, unload, and observe IPC modules |

**Typed events.** Pass an event map to `createIpcHelpers<TEmit>()` to type `event.reply`, `event.sender.send`, and `event.senderFrame?.send`. Emitted events are **not** prefixed by `defineIpcModule`.

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

**Container.**

```ts
const ipc = createIpcContainer();

await ipc.load("profile", createProfileIpc(service));
await ipc.loadAll({ profile, settings });

ipc.on("loaded", (name, channels) => {});
ipc.on("unloaded", (name) => {});
ipc.on("error", (name, error) => {});

ipc.unload("profile");
ipc.unloadAll();
```

Reloading a module with the same name unloads the previous version first.

### Rollup plugin (`electron-ipc-module/rollup-plugin`)

Analyzes `*.ipc.ts` files and generates a typed bridge for the renderer.

| Option | Default | Description |
| --- | --- | --- |
| `ipcDir` | `./src/ipc` | Directory or glob of IPC module files |
| `outFile` | `./src/generated/ipc-bridge.ts` | Generated TypeScript output |
| `tsconfig` | `./tsconfig.json` | TypeScript config used for static analysis |

**Naming conventions**

| Source | Generated API |
| --- | --- |
| `profile.ipc.ts` | `bridge.profile` |
| channel `"get-all"` | `bridge.profile.getAll()` |
| event `"profile-updated"` | `bridge.profile.onProfileUpdated(...)` |

**Static analysis tips**

- Use `*.ipc.ts` file names
- Prefer a plain object literal in `defineIpcModule(...)`
- Avoid spreads in the channels object for complete bridge typing

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
