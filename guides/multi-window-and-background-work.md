---
title: Multi-window and background-work patterns
---

# Multi-window and background-work patterns

Electron's `ipcMain` is process-wide, while windows and their `WebContents`
have independent lifetimes. Design one-shot behavior, event routing, progress,
and cancellation with that distinction in mind.

## One-shot channels are process-scoped

`handleOnce` and `listenOnce` install one global `ipcMain` registration. The
first call from any window consumes it:

- later `invoke` calls reject because no handler remains;
- later fire-and-forget sends are silently ignored.

Use them only when the operation is genuinely process-wide. For per-window
initialization, use a normal handler and track sender state:

```ts
const initialized = new WeakSet<Electron.WebContents>();

const initialize = handle((event) => {
  if (initialized.has(event.sender)) return { initialized: false };
  initialized.add(event.sender);
  initializeWindow(event.sender);
  return { initialized: true };
});
```

The `WeakSet` does not keep destroyed `WebContents` alive.

## Target events unless the data is truly global

Inside a channel callback, `event.sender.send` replies to the sending
`WebContents`. `event.reply` follows Electron's frame-aware reply behavior and
is useful when subframes are involved.

For independent producers, use a typed emitter:

```ts
type JobEvents = {
  "job-progress": [jobId: string, percent: number];
  "job-completed": [jobId: string];
};

const registerJobsIpc = defineIpcModule("jobs", channels, { eventPrefix: true });
export const jobEvents = defineIpcEvents<JobEvents>();

const jobs = createIpcEmitter<JobEvents>(registerJobsIpc);
jobs.emitTo(owner.webContents, "job-progress", jobId, 50);
```

Passing the register function keeps the emitter's physical event prefix aligned
with bridge generation. A literal prefix works, but must be updated manually if
the module changes.

`emit()` broadcasts to every live `BrowserWindow`, including hidden windows.
Reserve it for truly application-wide state such as a theme or connectivity
change. Use `emitTo()` for document, account, tenant, or user-specific data.
Destroyed targets are ignored. See [securing IPC channels](./security.md) for
why targeting is a confidentiality decision, not just a routing one.

## Clean up renderer subscriptions

Generated `on<Event>` and `once<Event>` methods return an unsubscribe function:

```ts
const unsubscribe = window.ipc.jobs.onJobProgress((jobId, percent) => {
  renderProgress(jobId, percent);
});

// When the component, route, or window-owned controller is disposed:
unsubscribe();
```

Treat the subscription as a resource owned by the view that created it. This
prevents duplicate callbacks after remounts and keeps old closures from
retaining UI state.

## Report progress from long-running work

Use an invoke for the final result and typed events for intermediate progress.
Include a stable operation ID in every message so concurrent jobs cannot update
the wrong view:

```ts
const exportReport = handle(async (event, jobId: string) => {
  for (const step of steps) {
    if (event.signal.aborted) return { cancelled: true };
    const result = await runStep(step);
    if (event.signal.aborted) return { cancelled: true };
    event.sender.send("job-progress", jobId, result.percent);
  }
  return { cancelled: false };
});
```

`event.signal` aborts when the calling `WebContents` is destroyed. It is shared
by all invocations from that sender and remains valid after a handler settles.
It is cooperative: it does not interrupt work or settle the renderer's promise
by itself. Check it before expensive steps.

The `send` above needs no guard of its own. `event.sender.send`,
`event.senderFrame?.send`, and `event.reply` drop the event once the target is
destroyed, so the window closing between the `aborted` check and the send costs
nothing — it does not throw `Object has been destroyed` in main. The signal is
there to stop the _work_, not to make the send safe.

Reading the signal requires a runtime with a global `AbortController`, which
Electron provides from version 15. Handlers that do not read it continue to
work on the package's Electron 12 peer floor.

## Wire the signal into the work, not just the loop

Checking `aborted` between steps only cancels work the handler itself drives.
A child process, a file lock, or an open socket outlives the window unless the
signal reaches the thing holding it. `event.signal` is a real `AbortSignal`, so
pass it down rather than polling it:

```ts
const transcode = handle(async (event, input: string) => {
  // Node terminates the child when the WebContents is destroyed.
  const child = spawn("ffmpeg", ["-i", input, "out.mp4"], { signal: event.signal });
  return await onceExit(child);
});
```

`fs/promises`, `fetch`, `stream.pipeline`, and `events.once` accept it the same
way. When a Cancel button has to abort the same work, compose the two with
`AbortSignal.any([event.signal, jobController.signal])` — Node 20.3 and newer,
so Electron 29 upward — or use the two-channel pattern below on older runtimes.

For a resource with no `signal` option, release it from an abort listener, and
remove that listener when the operation ends:

```ts
const withLock = handle(async (event, path: string) => {
  const lock = await acquireLock(path);
  const onAbort = () => void lock.release();
  event.signal.addEventListener("abort", onAbort);
  try {
    return await useLock(lock);
  } finally {
    event.signal.removeEventListener("abort", onAbort);
    await lock.release();
  }
});
```

The `finally` matters more here than in most cleanup. The signal is shared by
every invocation from that sender and lives as long as the window, so a
listener registered per call and never removed accumulates for the window's
lifetime, and each closure keeps what it captures — the lock, the child process
handle — reachable until the window closes. APIs that take a `signal` option
manage their own listener; hand-registered ones are yours to remove.

## Let a live renderer cancel explicitly

Closing a window aborts `event.signal`; pressing a Cancel button does not. Add a
second channel when cancellation must work while the renderer stays alive:

```ts
const cancelled = new Set<string>();

const channels = {
  export: handle(async (event, jobId: string) => {
    try {
      for (const step of steps) {
        if (cancelled.has(jobId) || event.signal.aborted) return { cancelled: true };
        await runStep(step);
      }
      return { cancelled: false };
    } finally {
      cancelled.delete(jobId);
    }
  }),
  cancel: listen((_event, jobId: string) => {
    cancelled.add(jobId);
  }),
};
```

Generate operation IDs in trusted code when collisions or cross-window
interference matter. Associate each job with its owning `WebContents`, and
authorize the cancel request against that owner rather than accepting any
renderer that knows an ID.

## Navigation and destruction differ

A `WebContents` can survive a reload or in-place navigation. Such navigation
abandons a pending renderer invocation without destroying the sender, so
`event.signal` does not abort. If navigation must cancel work, connect the
window's navigation lifecycle to application cancellation state.

Conversely, a retained signal aborts even after its original handler has
settled when the sender is eventually destroyed. Do not use it as an operation
completion signal; it represents sender lifetime only.

## Shut down background producers

Return cleanup from the module's `ready` hook for timers, watchers, and other
resources created with the module:

```ts
defineIpcModule("jobs", channels, {
  ready: () => {
    const timer = setInterval(scanQueue, 1_000);
    return () => clearInterval(timer);
  },
});
```

Cleanup runs when the module is unloaded, replaced, or disposed through its
container — see [module architecture and lifecycle](./module-lifecycle.md).
Producers owned outside a module should have an equally explicit application
shutdown owner.
