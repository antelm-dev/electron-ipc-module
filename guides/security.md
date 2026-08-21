---
title: Securing IPC channels
---

# Securing IPC channels

Treat every renderer message as untrusted input. TypeScript makes application
code easier to maintain, but its types are erased at runtime and do not stop a
compromised renderer from calling a known physical channel with arbitrary
values.

This guide supplements Electron's security guidance; it does not replace it.

## Start with a narrow preload surface

Use a context-isolated, sandboxed renderer:

```ts
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: preloadPath,
  },
});
```

Expose the generated bridge with `contextBridge`. It contains wrappers only for
statically declared channels and does not expose raw `ipcRenderer.send`,
`invoke`, or `on`. Never add a generic method that accepts a channel string;
doing so bypasses that allowlist.

Bundle a sandboxed preload to one self-contained CommonJS file and keep
`electron` external. See
[build and preload troubleshooting](./build-and-preload-troubleshooting.md).

## Authorize the sender

Use `authorize` for rules shared by a module:

```ts
const registerFilesIpc = defineIpcModule("files", channels, {
  authorize: (event, context) => {
    const url = event.senderFrame?.url;
    if (!url) return false;

    const source = new URL(url);
    return (
      source.protocol === "app:" && source.hostname === "local" && allowedChannels.has(context.key)
    );
  },
});
```

Make the allow decision from trusted main-process state. A renderer-provided
role, user ID, file root, or capability flag is input, not proof.

Important details:

- `senderFrame` can be `null`; fail closed when the rule requires a frame.
- Check the exact web origin or application protocol and host you own. Broad
  `startsWith("https://example.com")` checks can accept lookalike hosts.
- Consider subframes. If only the top-level document may call a privileged
  channel, verify that condition explicitly for the Electron versions you
  support.
- Navigation changes trust. Keep external content out of privileged windows and
  enforce navigation and new-window policies in the main process.
- `authorize` runs before validation and the channel callback. Returning exactly
  `false` produces `IpcAuthorizationError`; a thrown error is preserved.

Authorization is often module-wide, but permission may depend on
`context.key`. Split modules when their trust levels or ownership differ
substantially.

## Validate every privileged payload

The `validate` map is keyed by the module's channel keys. A callback validator
may inspect the raw arguments, event, and channel context:

```ts
defineIpcModule("files", channels, {
  validate: {
    read: (args) => {
      if (args.length !== 1 || typeof args[0] !== "string") {
        throw new TypeError("expected one path");
      }
    },
  },
});
```

For parsing, use a Standard Schema implementation such as Zod, Valibot, or
ArkType. The schema validates the full argument tuple, not only the first
argument:

```ts
import { z } from "zod";

const readArgs = z.tuple([z.string().min(1).max(4096)]);

defineIpcModule(
  "files",
  {
    read: handle((_event, path: string) => readAllowedFile(path)),
  },
  {
    validate: { read: readArgs },
  },
);
```

Successful parsed output replaces the arguments passed to the callback. This
means coercion and stripped fields take effect, and the schema output must
match the handler's parameter tuple. Schema failures become
`IpcValidationError` and preserve their issues.

Validation should constrain meaning as well as shape:

- normalize a path, resolve it against an allowed root, and verify the resolved
  path remains inside that root;
- allowlist commands, operations, URL schemes, and hosts rather than rejecting
  a few known-bad values;
- cap string, array, buffer, and collection sizes before expensive work;
- derive account or tenant scope from authenticated main-process state;
- reject unexpected tuple elements and object keys when the schema library
  supports it.

## Choose targeted events by default

`createIpcEmitter().emit()` sends to every live `BrowserWindow`, including
hidden windows. Do not broadcast user-specific, tenant-specific, or otherwise
sensitive data. Prefer `emitTo(webContents, ...)` when one renderer owns the
result.

Event namespacing prevents accidental channel overlap, not unauthorized
observation. The generated bridge narrows what application code can subscribe
to, while main-process routing still decides which window receives the data.

## Handle failures without leaking internals

An invoke rejection travels back to `ipcRenderer.invoke`, but Electron does not
preserve every custom error property across that boundary. Log a diagnostic in
the main process and return a stable, non-sensitive application error to the
renderer where appropriate.

Fire-and-forget listeners have no response channel. Configure
`onListenerError` so failures reach application logging rather than becoming
unhandled rejections. Avoid logging raw secrets, tokens, full file contents, or
unbounded attacker-controlled values.

The exact propagation rules are documented in the [error contract](./error-contract.md).

## Review checklist

- The renderer uses `contextIsolation: true`, `nodeIntegration: false`, and a
  sandbox unless a documented constraint requires otherwise.
- The preload exposes generated, named methods rather than raw IPC primitives.
- Every privileged channel authenticates or authorizes its sender.
- Every privileged payload has runtime validation and resource limits.
- Paths and URLs are resolved and allowlisted before use.
- Sensitive events are targeted to the correct `WebContents`.
- Listener failures and security decisions are observable without leaking
  secrets.
- The generated bridge is committed and checked in CI so new renderer
  capabilities are visible in review.
