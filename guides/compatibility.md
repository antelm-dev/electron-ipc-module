---
title: Compatibility and stability
---

# Compatibility and stability

The short version lives in the [README](../README.md#installation). This page records what CI actually verifies, why each floor is where it is, and what a major version protects.

## Compatibility contract

- **Modules:** ESM only. Use `import`; CommonJS `require()` is not a supported entry point. This applies to the package itself — your preload output is a separate question, covered in [preload constraints](../README.md#preload-constraints).
- **Node.js:** `>=22.5.0`. The floor is not the start of a major line because the generator resolves `ipcDir` with Node's own globbing rather than a dependency: `fs.globSync` arrived in 22.0.0 and `path.matchesGlob` in 22.5.0, and below that a glob `ipcDir` throws. CI runs the packed-artifact job at 22.5.0 exactly — driving the built package with plain Node, including the glob paths that reach both APIs — so the floor is tested rather than merely claimed. The unit matrix runs the latest 22 and 24.
- **Electron:** two different claims, deliberately kept apart.
  - The peer range is `>=12`, an **API-compatibility** claim: nothing here uses an Electron API newer than 12. It is a permissive install-time constraint because npm enforces it, and refusing to install on a version that works helps nobody.
  - **Build/type-checked** support is narrower. CI installs the latest patch of Electron's three currently supported stable majors — 41, 42, and 43 when this contract was frozen — and runs the type check, the public-API check, and the unit suite against each, advancing with [Electron's latest-three-stable support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines). A separate packed-consumer check installs Electron 12.2.3 with TypeScript 5.0.4, generates a bridge, and compiles the public API; majors between 12 and the current support window should work but are not checked individually. Bug reports from that range are welcome and will be treated as real.
  - **The matrix does not launch Electron; one job does.** The unit suite mocks Electron (`test/setup.ts`), so the matrix shows that this package compiles and type-checks against each major — not that IPC behaves identically at runtime on all three. Separately, the `example` job runs [`example/smoke.ts`](../example/smoke.ts) under a real Electron process on the latest supported major: it loads the generated bridge into a sandboxed, context-isolated preload and drives an `invoke`, a `send`, and both main-to-renderer event paths, asserting on the results. That is what proves the generator and the runtime agree on channel names — the one thing a mock cannot show. Structured-clone edge cases beyond those four calls are still covered against the mock only.
- **TypeScript:** `>=5.0.0 <7`, an install-enforced peer dependency. The packed-consumer matrix runs generation and public-API compilation on 5.0.4, the latest 5.x, and 6.x. The generator stack imports `typescript` at runtime for program and type-checker access. TypeScript 7 moved that API off the package's root entry point (`exports["."]` now resolves to `lib/version.cjs`) and behind `typescript/unstable/*`, so it is excluded until the replacement API loses its `unstable` prefix.
- **Package paths:** only `.`, `./rollup-plugin`, and `./generator` are public. Files under `dist/` are implementation details. Only `./rollup-plugin`, `./generator`, and the CLI need `typescript`; the `.` runtime entry does not import it.

## 1.0 stability contract

Starting with 1.0.0, this project follows Semantic Versioning. A breaking change to the following requires a new major version:

- documented exports and their TypeScript signatures on `.`, `./rollup-plugin`, and `./generator`;
- documented runtime behavior, error classes and public properties, CLI commands and flags, and generated bridge method names and types;
- the declared Node.js, Electron, and TypeScript compatibility ranges, when a previously accepted version is removed.

Patches may correct behavior that contradicts the documentation, close a security hole, or fix types without rejecting previously supported source. A new compile error in previously valid use is breaking unless it is required to close a vulnerability. Generated source formatting, internal helper names, logger and diagnostic wording, analyzer warning order, files below `dist/`, and test utilities are not public API. Deprecations will be documented before removal whenever a safe transition is possible.

## Where the public types live

**The root is runtime-only.** It exports the runtime values documented in the [README](../README.md)'s API table, plus `IpcAuthorizationError`, `IpcValidationError`, `IpcChannelCollisionError`, `IpcContainerDisposedError`, and `IpcObserverError`. Its exported types are the callback/event types (`IpcHandler`, `IpcListener`, typed Electron event/sender types), module/container registration types, option/context/validator types, channel definition types, and the general `MaybePromise`, `MethodsOnly`, `Serializable`, `IpcUncloneable`, and `LoggerLike` helpers. These lower-level types are public so wrappers and tooling can describe compatible registrations without importing internal files.

**The generator's own types are not on the root.** `IpcBridgeOptions`, `ResolvedIpcBridgeOptions`, `AnalyzedIpcModule`, `ChannelInfo`, and `EmittedEventInfo` describe how the bridge is _produced_, not what a main-process consumer depends on, so they live on `electron-ipc-module/generator` alongside the functions that return them. Keeping them off the root means the analyzer's output shape can change without that being a breaking change for everyone who only ever imports `defineIpcModule`.

`electron-ipc-module/rollup-plugin` exports the plugin default plus `IpcBridgeOptions` and `LoggerLike` — the same import works in a Vite config, since the plugin implements Vite's compatible plugin API. `electron-ipc-module/generator` exports `resolveIpcBridgeOptions`, `getIpcBridgeWatchTargets`, `isIpcBridgeRelevantFile`, and `runIpcBridgeGeneration`, plus the five types above and `LoggerLike`.

Compile-time API tests import all of this through the built package export map; no public-contract test imports `src`. The moved types are additionally asserted _absent_ from the root, so a barrel re-export cannot quietly widen the surface again.
