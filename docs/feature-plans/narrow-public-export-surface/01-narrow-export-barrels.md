# Task 01: Narrow and lock the package barrels

## Mission

Make the built package root runtime-only while exposing all generator-facing option and analysis types from `electron-ipc-module/generator`, with compile-time regression coverage and accurate public API documentation. Read the supplied coordinator README before changing code.

## Launch base and isolation

- Delivery: `integration-only`, intended for `codex/integrate-narrow-public-export-surface` after review.
- Base policy: `latest-default`; no task prerequisites.
- Coordinator: refresh `origin/main`, record `<exact-launch-base>`, and create the integration branch at that commit before launch.
- Worker branch: `codex/narrow-public-export-surface-01`.
- Sibling worktree: `E:\Adel\Documents\Orgs\electron-libs\ipc-module-narrow-exports-01`.

```text
git worktree add E:\Adel\Documents\Orgs\electron-libs\ipc-module-narrow-exports-01 -b codex/narrow-public-export-surface-01 <exact-launch-base>
cd E:\Adel\Documents\Orgs\electron-libs\ipc-module-narrow-exports-01
git status --short --branch
```

Start only from a clean status and report the exact launch SHA.

## Context and owned scope

Primary ownership is limited to:

- `src/shared/types/index.ts` — currently wildcard-exports runtime and bridge types into the root via `src/index.ts`.
- `src/bridge/ipc-bridge.ts` — implementation behind the existing `./generator` package export.
- `test/public-api/exports.ts` — built-package API contract; it must cover positive subpath imports and negative root imports.
- `README.md` — especially “Intentional public exports” and adjacent generator wording.

`package.json` already maps `./generator`; do not add or change an export-map entry unless inspection proves the existing declaration target cannot serve the required types.

## Required work

1. Stop the root type barrel from exporting `src/shared/types/bridge.ts`. Preserve the complete runtime surface and `Serializable`; do not hand-curate away unrelated runtime types.
2. Explicitly type-export `IpcBridgeOptions`, `ResolvedIpcBridgeOptions`, `AnalyzedIpcModule`, `ChannelInfo`, and `EmittedEventInfo` from the generator entry. Keep the existing Rollup plugin `IpcBridgeOptions` export valid.
3. Update the package-level compile fixture so all five types are imported from `electron-ipc-module/generator`, not the root. Add focused `@ts-expect-error` negative imports/assertions for every bridge type at the root; these must fail if the root widens again and must not rely on `src` paths.
4. Update README claims to state that the root is runtime-oriented, the generator subpath owns generator types/functions, and the Rollup path owns its plugin option type.

Meet AC-ROOT, AC-GENERATOR, AC-GUARD, and AC-DOCS from the coordinator README. Generator behavior, runtime implementation, type shapes, and physical type-definition placement are unchanged.

## Verification and delivery

Run:

```text
pnpm run test:api
pnpm run typecheck
git diff --check
git status --short
```

Also inspect the complete diff and built declaration resolution to confirm tests exercise package specifiers. Use 1–3 logical conventional commits. Do not push, open a PR, merge, or edit the planning documents. Finish with commit SHAs, changed files, check results, final clean/dirty status, and any compatibility or declaration-emission risks. Integration becomes eligible only after coordinator review and `pnpm run check` passes on the integration branch.
