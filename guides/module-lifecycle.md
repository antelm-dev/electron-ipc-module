---
title: Module architecture and lifecycle
---

# Module architecture and lifecycle

An IPC module should adapt a cohesive main-process capability to a narrow
renderer-facing API. Keep business logic in injected services, use the module
for boundary concerns, and let an IPC container own registration and cleanup.

## Inject services instead of importing global state

Export a factory when handlers depend on application services:

```ts
export function createProfileIpc(service: ProfileService) {
  return defineIpcModule("profile", {
    get: handle((_event, id: string) => service.get(id)),
    save: handle((_event, input: ProfileInput) => service.save(input)),
  });
}
```

This keeps the channel declaration close to its transport types while making
the service independently testable and allowing startup code to choose the
actual implementation.

Group channels by capability and trust boundary, not by renderer screen. A
profile window and settings window may both use a `profile` capability; giving
each screen its own duplicate registration creates avoidable collisions and
lifecycle ambiguity.

## Load modules after dependencies are ready

Create one application-level container and load a startup batch:

```ts
const ipc = createIpcContainer();

await ipc.loadAll({
  profile: createProfileIpc(profileService),
  settings: createSettingsIpc(settingsService),
});
```

`loadAll` is insert-only and transactional. It rejects before registration if
any supplied name is already loaded. If a later registration fails, every
earlier module from that batch is unloaded in reverse order.

The object keys are container identities used for lifecycle and observation;
the prefixes inside `defineIpcModule` are physical channel namespaces. Keeping
them equal is a useful convention, but the container does not require it.

## Acquire and release module-owned resources

Use `ready` for work that must happen after every channel has registered. It may
return a synchronous cleanup callback:

```ts
return defineIpcModule("documents", channels, {
  ready: async () => {
    const watcher = await createDocumentWatcher();
    return () => watcher.close();
  },
});
```

If channel registration or `ready` fails, already registered channels are
rolled back. On unload, channel cleanup and module cleanup are all attempted;
multiple failures are reported with `AggregateError`.

Keep cleanup idempotent when practical. A resource may already have stopped
because of an external event, and cleanup should still leave the module in a
known state.

## Replace one module deliberately

`load(name, register)` replaces a committed module with the same container
name. It unloads the old registration before starting the new one:

```ts
await ipc.load("profile", createProfileIpc(nextService));
```

If replacement registration fails, the previous module stays unloaded. This
avoids two implementations claiming the same Electron channels, but it is not
a rollback to the old behavior. If uninterrupted service is required, validate
the new dependency outside registration before replacing the module.

Use `loadAll` for a new transactional group and `load` for intentional
individual replacement; `loadAll` never replaces existing names.

## Understand queue and read semantics

All lifecycle mutations share one FIFO queue:

- `load`, `loadAll`, `unload`, `unloadAll`, and `dispose` execute in invocation
  order;
- operations for different module names do not interleave;
- reads such as `has`, `names`, `size`, and `getChannels` report committed state
  immediately and do not wait for queued work.

Always await a mutation before reading when the caller needs to observe its
result:

```ts
await ipc.load("profile", registerProfile);
if (ipc.has("profile")) startWindows();
```

Calling `load()` and then `unload()` without awaiting the first call still
queues them in that order, but handling both returned promises makes failures
visible.

## Observe without controlling lifecycle

Container events are notifications:

```ts
ipc.on("loaded", (name, channels) => logger.info({ name, channels }));
ipc.on("unloaded", (name) => logger.info({ name }));
ipc.on("error", (name, error) => logger.error({ name, error }));
```

A `loaded` or `unloaded` observer that throws does not undo completed work. Its
exception is reported to `error` as `IpcObserverError`. Keep observers small;
schedule unrelated asynchronous work rather than treating the event as part of
the registration transaction.

The [error contract](./error-contract.md) describes the terminal cases for a
throwing or absent `error` observer.

## Detect namespace collisions early

Physical Electron channel names must be unique across committed modules,
regardless of whether a channel is a handler or listener. The container rejects
an incoming registration with `IpcChannelCollisionError` and cleans it up.

Use stable, capability-oriented prefixes and avoid empty prefixes except when
preserving legacy names. Generated bridge module names come from file names, so
also keep one `defineIpcModule` per `*.ipc.ts` file.

## Choose unload, unloadAll, or dispose

- `unload(name)` removes one module and returns `false` when it is unknown.
- `unloadAll()` attempts every loaded module and leaves the container reusable.
- `dispose()` attempts every loaded module and permanently closes the
  container. It is idempotent; repeated calls return the same promise.

Once `dispose()` is requested, later lifecycle calls reject with
`IpcContainerDisposedError`. Reads remain available and eventually show the
final committed state.

At application shutdown, await `dispose()` before tearing down services used by
module cleanup:

```ts
app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  void ipc.dispose().finally(() => app.quit());
});
```

Adapt the shutdown guard to the rest of the application so repeated quit
events do not create a loop.
