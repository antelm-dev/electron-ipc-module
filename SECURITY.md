# Security policy

## Supported versions

Until 1.0.0, security fixes go to the latest pre-1.0 release. Starting with 1.0.0, fixes are released on the latest stable major. There are no maintenance branches for older majors or pre-1.0 releases; upgrade before reporting, if you can. Reports that also affect an older release are still useful, but the fix will target the supported line.

| Version                           | Supported |
| --------------------------------- | --------- |
| latest stable major               | yes       |
| latest `<1.0` (until 1.0 ships)   | yes       |
| older majors and pre-1.0 releases | no        |

## Reporting a vulnerability

Use GitHub's private reporting — **[Report a vulnerability](https://github.com/antelm-dev/electron-ipc-module/security/advisories/new)** — which keeps the discussion private until a fix ships.

Please do not open a public issue for a vulnerability. If you get no acknowledgement after a couple of weeks, open a normal issue saying you are waiting on a security report, with no details in it.

Useful things to include: the affected version, whether the main process or the generated bridge is involved, and the smallest `*.ipc.ts` and call that shows the problem.

## What is in scope

The package's job is to keep the renderer's reachable surface equal to the channels you declared. In scope:

- The generated bridge exposing a channel that no `defineIpcModule` declared, or a channel name that differs from the one registered on `ipcMain`.
- A way for the renderer to reach `ipcRenderer.invoke`/`send`/`on` generically through the bridge, rather than only through the generated wrappers.
- `authorize` or `validate` being bypassed, or their rejection reaching the renderer as a success.
- The container leaving channels registered after `unload`/`dispose` reports them removed.
- Code execution in the generator from analyzing a `*.ipc.ts` file. It type-checks sources but never runs them.

## What is not

These are documented behaviour, not vulnerabilities. See the [security model](./README.md#security-model) for the reasoning.

- **A compromised renderer sending anything to a declared channel.** Types are erased at runtime. `Serializable<T>` and the typed bridge are correctness tools, not a trust boundary — validate in the main process with `authorize`/`validate` or checks inside the handler.
- **Anything a handler itself does with its input.** A handler that takes a path from the renderer and reads it is doing that on its own account.
- **Running with `contextIsolation: false`, `nodeIntegration: true`, or `sandbox: false`.** The generated bridge assumes Electron's defaults; the runtime does not verify them, and disabling them removes a boundary this package never claimed to restore.
- **Electron and Chromium vulnerabilities.** Report those to [Electron](https://github.com/electron/electron/security/policy).
