---
title: Testing IPC modules
---

# Testing IPC modules

Most IPC behavior can be tested without starting Electron. Register a module
against a small `ipcMain` fake, capture the callbacks it installs, and invoke
those callbacks directly. Keep one real-Electron smoke test for the boundary a
mock cannot cover: whether the generated preload bridge and runtime agree on
physical channel names.

## Unit-test a module through its public boundary

Avoid exporting handler callbacks only for tests. The function returned by
`defineIpcModule` accepts an `ipcMain`-compatible object, so a test can observe
the same registration path used in production.

```ts
import { describe, expect, it, vi } from "vitest";
import { defineIpcModule, handle, listen } from "electron-ipc-module";

function createIpcMainFake() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Map<string, (...args: unknown[]) => unknown>();

  return {
    handlers,
    listeners,
    ipc: {
      handle: vi.fn((channel, callback) => handlers.set(channel, callback)),
      handleOnce: vi.fn((channel, callback) => handlers.set(channel, callback)),
      on: vi.fn((channel, callback) => listeners.set(channel, callback)),
      once: vi.fn((channel, callback) => listeners.set(channel, callback)),
      removeHandler: vi.fn(),
      removeListener: vi.fn(),
    },
  };
}

describe("profile IPC", () => {
  it("registers and runs its channels", async () => {
    const service = {
      get: vi.fn(async (id: string) => ({ id, name: "Ada" })),
      select: vi.fn(),
    };
    const register = defineIpcModule("profile", {
      get: handle((_event, id: string) => service.get(id)),
      select: listen((_event, id: string) => service.select(id)),
    });
    const fake = createIpcMainFake();

    await register(fake.ipc as never);

    const event = { sender: {}, senderFrame: null };
    await expect(fake.handlers.get("profile:get")!(event, "user-1")).resolves.toEqual({
      id: "user-1",
      name: "Ada",
    });
    fake.listeners.get("profile:select")!(event, "user-1");
    expect(service.select).toHaveBeenCalledWith("user-1");
  });
});
```

This style checks prefixing, registration, guards, event wrapping, and the
handler itself. A test that calls `service.get` directly checks none of those.

## Test authorization and validation

Call the captured callback with untrusted runtime values. Do not use only
TypeScript-valid inputs: the purpose of validation is to defend the erased
runtime boundary.

```ts
import {
  defineIpcModule,
  handle,
  IpcAuthorizationError,
  IpcValidationError,
} from "electron-ipc-module";

const register = defineIpcModule(
  "files",
  { read: handle((_event, path: string) => path) },
  {
    authorize: (event) => event.senderFrame?.url.startsWith("app://") === true,
    validate: {
      read: (args) => {
        if (typeof args[0] !== "string") throw new TypeError("path must be a string");
      },
    },
  },
);
```

Assert each stage separately:

- an untrusted frame rejects with `IpcAuthorizationError`;
- malformed input rejects before the handler runs;
- a Standard Schema failure is an `IpcValidationError` whose `issues` are
  preserved;
- parsed Standard Schema output, including coercion or field stripping, is
  what the handler receives;
- `listen` failures reach `onListenerError`, because a fire-and-forget sender
  cannot receive a rejected promise.

See the [error contract](./error-contract.md) for the expected result at every
stage.

## Test emitted events

Give the fake event a spied `sender.send` and `reply`. With
`eventPrefix: true`, assert the physical channel as well as its payload:

```ts
const sender = { send: vi.fn(), isDestroyed: () => false };
const event = { sender, senderFrame: null, reply: vi.fn() };

await capturedHandler(event);

expect(sender.send).toHaveBeenCalledWith("profile:updated", { id: "user-1" });
```

For `createIpcEmitter().emitTo`, provide a target with `send` and
`isDestroyed`. For broadcasts, mock `BrowserWindow.getAllWindows()` and assert
that live windows receive the event while destroyed ones do not.

Also test renderer listener cleanup at the component boundary. Every generated
`on<Event>` and `once<Event>` method returns an unsubscribe function; the test
should call it on unmount rather than relying on a later navigation to discard
the listener.

## Test container lifecycle

Use tiny register functions when the subject is the container rather than a
channel:

```ts
const register = async () => ({
  channels: [["profile:get", vi.fn()]] as const,
  cleanup: vi.fn(),
});

const container = createIpcContainer();
await container.load("profile", register as never);

expect(container.names).toEqual(["profile"]);
expect(container.getChannels("profile")).toEqual(["profile:get"]);
```

High-value lifecycle cases are replacement with `load`, transactional rollback
with `loadAll`, channel collisions, cleanup failures, FIFO ordering of
overlapping calls, and the terminal behavior of `dispose()`.

## Keep the generated bridge current in CI

Commit the generated bridge, then make staleness a CI failure:

```yaml
- run: npx electron-ipc-module check
```

Run the application's normal type check after that command. It verifies that
renderer calls still match the newly generated API and catches stale global
typing or an excluded generated file.

## Add one real-Electron smoke test

Mocks cannot prove that the runtime and generated preload use the same channel,
that the preload bundle loads in a sandbox, or that `contextBridge` exposes the
expected global. A small smoke test should therefore launch a hidden
`BrowserWindow` with production security settings and exercise at least:

- one `invoke` request and response;
- one fire-and-forget `send`;
- one main-to-renderer event;
- the built, bundled preload rather than a test-only replacement.

Give event assertions a timeout: a channel mismatch usually appears as an
event that never arrives. Report the verdict through a mechanism other than
the IPC path under test, such as `webContents.executeJavaScript`. The repository
[`example/smoke.ts`](../example/smoke.ts) is a complete reference.
