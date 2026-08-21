---
title: Migrating from raw Electron IPC
---

# Migrating from raw Electron IPC

Migration can be incremental. Convert one channel group at a time, keep its
existing physical names when compatibility matters, and remove the old preload
wrapper only after renderer callers use the generated bridge.

## Before: a manually synchronized channel

A typical Electron application repeats a channel name and its types in three
places:

```ts
// main
ipcMain.handle("profile:get", (_event, id: string) => profileService.get(id));

// preload
contextBridge.exposeInMainWorld("api", {
  getProfile: (id: string) => ipcRenderer.invoke("profile:get", id),
});

// renderer declaration
interface Window {
  api: { getProfile(id: string): Promise<Profile> };
}
```

The renderer declaration can drift from the actual handler, and a generic
preload wrapper can accidentally expose channels that were never meant to be
public.

## After: declare once and generate the bridge

Move the handler into a `*.ipc.ts` module:

```ts
// main/ipc/profile.ipc.ts
import { defineIpcModule, handle } from "electron-ipc-module";

export const registerProfileIpc = defineIpcModule("profile", {
  get: handle((_event, id: string) => profileService.get(id)),
});
```

Load it in the main process:

```ts
const ipc = createIpcContainer();
await ipc.load("profile", registerProfileIpc);
```

Generate and expose the bridge:

```ts
ipcBridge({
  ipcDir: "./main/ipc",
  outFile: "./main/generated/ipc-bridge.ts",
  tsconfig: "./tsconfig.preload.json",
  expose: "api",
});
```

The renderer call becomes `window.api.profile.get(id)`. Its argument and return
types now come from the handler rather than a duplicated declaration.

## Preserve physical channel names

`defineIpcModule(prefix, channels)` joins the prefix and key with a colon. To
retain `profile:get`, use prefix `"profile"` and key `"get"`. An empty prefix
retains an unnamespaced channel:

```ts
defineIpcModule("", {
  "legacy-channel": handle(callback),
});
```

Renderer method names are normalized to JavaScript identifiers. For example,
`get-all` becomes `getAll`. Review the committed generated bridge during each
migration so API renames are explicit.

## Convert each Electron channel kind

| Existing Electron registration | Module helper | Generated renderer method |
| ------------------------------ | ------------- | ------------------------- |
| `ipcMain.handle`               | `handle`      | Promise-returning method  |
| `ipcMain.handleOnce`           | `handleOnce`  | Promise-returning method  |
| `ipcMain.on`                   | `listen`      | Fire-and-forget method    |
| `ipcMain.once`                 | `listenOnce`  | Fire-and-forget method    |

One-shot channels are process-scoped because `ipcMain` is global. The first
window consumes them. Do not migrate a per-window initialization call to
`handleOnce`; use `handle` and track initialization by `event.sender` instead.

## Convert main-to-renderer events

First declare the event map and bind the helpers to it:

```ts
type ProfileEvents = {
  updated: [profile: { id: string; name: string }];
};

const { handle } = createIpcHelpers<ProfileEvents>();

export const registerProfileIpc = defineIpcModule(
  "profile",
  {
    save: handle(async (event, input: ProfileInput) => {
      const profile = await profileService.save(input);
      event.sender.send("updated", profile);
      return profile;
    }),
  },
  { eventPrefix: true },
);

export const profileEvents = defineIpcEvents<ProfileEvents>();
```

The generated listener is `window.api.profile.onUpdated(callback)`. Store and
call its returned unsubscribe function when the owning view unmounts.

Events from jobs, timers, or file watchers can move to `createIpcEmitter`.
Pass the module register function so it inherits the same `eventPrefix`:

```ts
const profileEvents = createIpcEmitter<ProfileEvents>(registerProfileIpc);
profileEvents.emitTo(window.webContents, "updated", profile);
```

## Add runtime guards during migration

Types do not validate messages from a compromised renderer. A migration is a
good time to identify privileged channels and add `authorize` and `validate`
before moving filesystem, network, shell, or credential operations behind the
new bridge. See [securing IPC channels](./security.md).

## Remove legacy code safely

For each migrated module:

1. Generate and commit the bridge.
2. Change renderer callers to the generated API.
3. Run `electron-ipc-module check` and the renderer type check.
4. Exercise the channel through the production preload bundle.
5. Remove its old `ipcMain` registration, preload wrapper, and handwritten
   renderer declaration.

Do not keep both registrations for the same physical channel. Electron will
reject duplicate handlers, and the IPC container also reports collisions
between loaded modules.
