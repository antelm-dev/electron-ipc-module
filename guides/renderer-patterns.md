---
title: Renderer patterns
---

# Renderer patterns

The generated bridge is the whole renderer-facing API. This guide covers what it
actually hands you, how to own a subscription's lifetime, and how to hold invoke
state without leaking updates into unmounted views.

## What the renderer receives

For each module the bridge emits one property per channel and, for each declared
event, an `on<Event>` / `once<Event>` pair:

```ts
window.ipc.greeting.get(); // Promise<Serializable<string>>
window.ipc.greeting.set("Ada"); // void — fire-and-forget
window.ipc.greeting.onGreetingChanged(listener); // () => void
```

Three properties of that shape are worth knowing before you build on it:

- **Listeners receive payload arguments only.** The generated helper strips
  Electron's `IpcRendererEvent` before calling you, so a `[greeting: string]`
  event arrives as `(greeting)`, not `(event, greeting)`.
- **Return types are already `Serializable<T>`.** They describe what structured
  clone actually delivers, not what the handler returned — see _What survives the
  boundary_ in the [README](../README.md#what-survives-the-boundary).
- **Every subscription returns an unsubscribe function**, including `once<Event>`.
  A one-shot listener that never fires still holds a reference until you call it.

Each subscription installs its own wrapper, so two views can listen to the same
event and unsubscribing one leaves the other running. Unsubscribing twice is a
no-op, which makes cleanup safe to call from a `finally` or a disposed scope.

## Type the global

With the generator's `expose` option, the generated file emits both the
`contextBridge.exposeInMainWorld` call and the matching `Window` declaration, so
the preload needs no bridge code of its own. Without it, derive the declaration
rather than retyping the API:

```ts
import type { bridge } from "../main/generated/ipc-bridge.js";

declare global {
  interface Window {
    ipc: typeof bridge;
  }
}
```

Either way the renderer's TypeScript project has to include the generated file.
If `window.ipc` types as `any` or errors as unknown, see
[build and preload troubleshooting](./build-and-preload-troubleshooting.md).

Treat the exposed object as read-only. It is a copy that crossed into the
renderer's world, not the module you generated — don't monkey-patch it, and
don't rely on object identity across the boundary. The methods themselves are
plain arrow functions with no `this`, so destructuring them is fine:

```ts
const { get, onGreetingChanged } = window.ipc.greeting;
```

## Own the subscription for exactly as long as the view

The single most common renderer bug is a subscription that outlives its
component. React's StrictMode makes it visible in development by mounting every
effect twice: a listener that is not cleaned up fires twice per event, which
reads as a main-process bug and is not one.

The unsubscribe contract maps directly onto effect cleanup:

```tsx
import { useEffect, useRef } from "react";

type Unsubscribe = () => void;

export function useIpcEvent<TArgs extends unknown[]>(
  subscribe: (listener: (...args: TArgs) => void) => Unsubscribe,
  listener: (...args: TArgs) => void,
) {
  const latest = useRef(listener);
  latest.current = listener;

  // `subscribe` is a stable property on the frozen bridge, so this effect runs
  // once per mount. The ref keeps the callback current without resubscribing.
  useEffect(() => subscribe((...args) => latest.current(...args)), [subscribe]);
}
```

```tsx
useIpcEvent(window.ipc.jobs.onJobProgress, (jobId, percent) => {
  setProgress((current) => ({ ...current, [jobId]: percent }));
});
```

The same rule in other frameworks:

```ts
// Vue — any reactive scope, not just a component
import { onScopeDispose } from "vue";
onScopeDispose(window.ipc.jobs.onJobProgress(handler));
```

```ts
// Svelte 5 — $effect may return its cleanup directly
$effect(() => window.ipc.jobs.onJobProgress(handler));
```

## Hold invoke state without updating a dead view

An `invoke` that resolves after its view unmounts should be discarded. The
main-process `event.signal` does not help here: it tracks destruction of the
`WebContents`, so it stays inactive for an ordinary unmount or route change.
Guard on the renderer side:

```tsx
type Result<T> =
  { status: "loading" } | { status: "ok"; value: T } | { status: "error"; error: unknown };

function useInvoke<T>(call: () => Promise<T>, deps: unknown[]): Result<T> {
  const [state, setState] = useState<Result<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    call().then(
      (value) => !cancelled && setState({ status: "ok", value }),
      (error) => !cancelled && setState({ status: "error", error }),
    );
    return () => {
      cancelled = true;
    };
  }, deps);

  return state;
}
```

For work the main process should also stop doing, send an explicit cancel
message rather than relying on the renderer discarding the result — see
[multi-window and background-work patterns](./multi-window-and-background-work.md).

## Expect errors as messages, not classes

A rejected `invoke` arrives as an `Error` whose message crossed the boundary.
Custom error subclasses, added fields, and `instanceof` checks do not survive,
so branch on a stable field you put in the payload rather than on the error's
type. Fire-and-forget `send` calls have no response at all: a listener that
throws in the main process is reported through `onListenerError` there, and the
renderer never learns of it. The [error contract](./error-contract.md) states
what each stage produces.

## Do not rebuild a generic channel API

The bridge's value is that it is an allowlist: the renderer can reach the
channels you declared and nothing else. A convenience wrapper that accepts a
channel name — `invoke(channel, ...args)` — gives that away, and no amount of
renderer-side care restores it. Add a channel to a `*.ipc.ts` module instead and
let the generator widen the surface visibly, in a diff someone reviews. See
[securing IPC channels](./security.md).
