---
title: Diagnostics reference
---

# Diagnostics reference

Every message this package produces, what causes it, and what to change. Search
for the literal text you saw. For failure _behavior_ — which stage swallows an
error and which propagates it — see the [error contract](./error-contract.md);
for symptom-first debugging of a build that produces no message at all, see
[build and preload troubleshooting](./build-and-preload-troubleshooting.md).

## Generation aborts

These throw and write no output. The CLI reports them and exits non-zero; the
Rollup plugin fails the build. Nothing is partially generated, so the committed
bridge stays as it was.

### `a file may declare only one defineIpcModule`

Prefixed with `file:line:column`. The bridge groups channels under one entry
named after the file, so a second module in the same file would never reach the
renderer while still registering successfully in main — the two sides would
disagree silently. Move the second module into its own `*.ipc.ts` file.

### `defineIpcModule prefix must be a string literal`

The prefix was a variable, constant, or template expression. The generator reads
it statically to compute physical channel names, and cannot evaluate your code.
Inline the literal:

```ts
// Not analyzable
defineIpcModule(PREFIX, channels);

// Analyzable
defineIpcModule("profile", channels);
```

### `… produces invalid bridge identifier "…"`

A channel key, event name, module file name, or `expose` value did not convert
into a valid JavaScript identifier. Keys are camel-cased and event names
pascal-cased, so a name beginning with a digit, or containing punctuation other
than `-`, `_`, or a space, survives the conversion unusable: `2fa` stays `2fa`,
which cannot be a property in the generated object literal. The message prefix
names the source — `expose option`, `channel "…"`, `event "…" on-listener`, or
`module file "….ipc.ts"`. Rename it.

### `… contains a generated identifier collision for "…"`

Two names converted to the same identifier. Within `IPC module "<name>"` that
means two channel keys, or a channel and an event listener, collapsed together:
`get-all` and `getAll` both produce `getAll`. Within `IPC bridge` it means two
module files did, such as `my-module.ipc.ts` and `myModule.ipc.ts`. The message
names both sources. Rename one.

### `expose option "…" is already a standard global property`

The requested key already exists on `window` or `globalThis` — `name`,
`location`, `top`, `self`, `constructor`, and so on. Electron cannot overwrite
it and TypeScript cannot safely redeclare it, so the exposure would type-check
and then leave `window.<key>` untouched at runtime. Pick a key of your own, such
as `ipc`.

### `TypeScript failed with N error(s):`

Followed by formatted compiler diagnostics. This covers a missing or malformed
tsconfig (`TS5083: Cannot read file …`), invalid compiler options, and syntax or
type errors. Type errors are scoped to the IPC sources and the files they
import, so an unrelated broken file elsewhere in the project cannot fail
generation. If the diagnostics look like the whole project, check that
`tsconfig` points at the config you meant — a solution file with `"files": []`
produces zero modules rather than an error, which is the quieter version of the
same mistake.

### `Failed to inspect TypeScript's standard global declarations` / `… Window declarations`

The generator probes the standard library to learn which global keys `expose`
must avoid, and the probe came back empty. The resolved `lib` files are missing
or unreadable — check `lib`, `types`, and `typeRoots` in the tsconfig you
passed, and that `typescript` is installed where the generator runs.

## Generation continues with a warning

Logged as `[<module>] <message>`. Part of the bridge could not be typed
completely, and `--quiet` does not suppress these.

### `Spread in channels object - those entries cannot be typed in the bridge`

The channels object used a spread. Those channels register at runtime but the
analyzer cannot enumerate them, so the renderer gets no wrapper and the two
sides disagree. List the channels explicitly.

### `eventPrefix must be true or a string literal for bridge generation`

`eventPrefix` was a computed value. The runtime still applies it, but the
generator cannot know the physical event channel, so the generated listeners
subscribe to the wrong name. Use `true` or an inline string.

## Type errors where you declare the channel

### `Type 'IpcUncloneable<T>' is not assignable to type 'ChannelDef'`

The channel's arguments or return value cannot cross the IPC boundary —
typically a function, `Promise`, symbol, or a class instance carrying methods,
anywhere inside the payload. Structured clone rejects the whole payload rather
than dropping the offending member, so the check fires at the declaration
instead of producing a half-mapped renderer type. Return plain data, or map to a
DTO inside the handler. The full table of what survives is in the
[README](../README.md#what-survives-the-boundary).

### An unknown key in `validate`

The `validate` map is keyed against the declared channels, so a misspelled entry
is a compile error rather than a guard that silently never runs. Check the key
against the channels object.

## Runtime errors

| Error                       | `code`                   | Raised when                                                                                                                   |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `IpcAuthorizationError`     | —                        | `authorize` returned exactly `false`. A thrown authorization error is preserved instead of being replaced.                    |
| `IpcValidationError`        | —                        | A Standard Schema rejected the payload. Carries the schema's `issues` in the order it reported them.                          |
| `IpcChannelCollisionError`  | `IPC_CHANNEL_COLLISION`  | Two loaded modules claim the same physical channel, or one module declares it twice. The incoming registration is cleaned up. |
| `IpcContainerDisposedError` | `IPC_CONTAINER_DISPOSED` | A lifecycle call was made after `dispose()`. Terminal; reads still work.                                                      |
| `IpcObserverError`          | `IPC_OBSERVER_ERROR`     | A `loaded` or `unloaded` observer threw. Reported on `error`, and the completed work is not undone.                           |
| `AggregateError`            | —                        | Registration rollback, unload, or dispose hit more than one failure. Inspect `.errors`.                                       |

Plus these messages:

- **`IPC module "…" is already loaded`** — `loadAll` is insert-only. Use `load()`
  to replace one module deliberately.
- **`loadAll cannot replace already-loaded modules (…)`** — the same cause,
  raised before any registration starts so the batch stays transactional.
- **`event.signal requires a global AbortController, which Electron ships from 15.0.0`**
  — a handler read `event.signal` on an older runtime. The signal is built on
  first read, so handlers that never touch it keep working on the package's
  Electron 12 peer floor.
- **`[electron-ipc-module] Unhandled error in listener "…"`** — a `listen`
  channel rejected and no `onListenerError` was configured. Fire-and-forget
  channels have no response path, so the failure is logged rather than returned
  to the renderer. Configure the hook to route it into application logging.
- **`[electron-ipc-module] onListenerError failed for "…"`** — the hook itself
  threw. Keep it trivial; a hook that can fail loses both its own error and the
  original.

## CLI

- **`Generated bridge is stale: <path>`** — `check` found output that differs
  from what generation would write. Regenerate and commit the result. Options
  that differ between `generate` and `check` produce this even when nothing
  changed, so keep both in package scripts.
- **`Unknown command …` / `Unknown option …` / `… requires a value`** — see
  `electron-ipc-module --help`.
- **`check does not support --watch`** — `check` is a single verification pass.
  Use `generate --watch` for a watch loop.
