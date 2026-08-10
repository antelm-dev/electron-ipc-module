# Narrow the public export surface

## Goal and milestone

Before 1.0, make the package root a runtime-oriented API and place generator-specific types behind `electron-ipc-module/generator`. The milestone is complete when package consumers can still import runtime values/types and `Serializable` from the root, while generator consumers can import `IpcBridgeOptions`, `ResolvedIpcBridgeOptions`, `AnalyzedIpcModule`, `ChannelInfo`, and `EmittedEventInfo` from the generator subpath.

Interpret "root to runtime types + Serializable" to mean that `IpcBridgeOptions` also leaves the root; it remains public from both `./generator` and `./rollup-plugin`. The four named analysis/resolution types become available from `./generator`. No package export-map entry is added because `package.json` already maps `./generator` to `dist/bridge/ipc-bridge`.

This plan covers one pre-1.0 breaking API correction. It does not rename types, change generator behavior, reorganize their internal definitions, or alter runtime exports.

## Planning and repository context

- Planning ref: `codex/plan-narrow-public-export-surface`
- Source base: `7a47fca6bcd408f50fb7df99e223dfc728f4c28d`
- Default branch and remote: `main` on `origin`
- Integration branch: `codex/integrate-narrow-public-export-surface`
- Package API verification builds declarations, then compiles `test/public-api/exports.ts` through the published package specifiers with `pnpm run test:api`.

At launch, give the worker this README and `01-narrow-export-barrels.md` directly, or provide a readable planning ref plus both paths. The worker's source branch will not contain these documents when based on a refreshed `main`.

## Acceptance contract

- **AC-ROOT:** The root still exposes all existing runtime values and runtime-facing types/utilities, including `Serializable`, but no longer exposes any type declared by `src/shared/types/bridge.ts`.
- **AC-GENERATOR:** `electron-ipc-module/generator` exposes `IpcBridgeOptions`, `ResolvedIpcBridgeOptions`, `AnalyzedIpcModule`, `ChannelInfo`, and `EmittedEventInfo`; `electron-ipc-module/rollup-plugin` continues to expose `IpcBridgeOptions`.
- **AC-GUARD:** Built-package compile tests prove both allowed imports and rejected root imports, so a future wildcard re-export cannot silently widen the root again.
- **AC-DOCS:** The intentional-public-exports documentation describes the narrowed ownership without claiming generator types are root exports.

## Tasks and execution

| ID  | Outcome                             | Branch                                  | Depends on | Delivery           | Base policy      |
| --- | ----------------------------------- | --------------------------------------- | ---------- | ------------------ | ---------------- |
| 01  | Narrow and lock the package barrels | `codex/narrow-public-export-surface-01` | None       | `integration-only` | `latest-default` |

Wave 1 contains task 01. Before launch, refresh `origin/main`, record its exact commit, create the integration branch at that commit, then create the worker branch/worktree from that same exact commit. The wave gate is the worker's clean diff, targeted checks, and evidence for AC-ROOT through AC-DOCS.

This task is `integration-only` because it deliberately removes existing root imports and therefore does not meet the backward-compatibility requirement for an independently mergeable default-branch PR. After review, integrate its commits into `codex/integrate-narrow-public-export-surface`; remote push, PR creation, or merge requires separate authorization such as: `Review completed tasks and open or merge eligible PRs`.

## Verification and review

Worker checks are `pnpm run test:api` and `pnpm run typecheck`. The coordinator then runs `pnpm run check` on the integration branch and reviews the emitted declarations/package specifiers rather than testing source-path imports.

Critical end-to-end package-consumer scenarios:

1. A consumer imports runtime APIs and `Serializable` from `electron-ipc-module`, and compilation succeeds.
2. A consumer imports all five bridge option/analysis types plus generator functions from `electron-ipc-module/generator`, and compilation succeeds; the Rollup plugin option import remains valid.
3. A consumer attempts each bridge-only type from `electron-ipc-module`, and the compile-time negative assertions confirm those imports are unavailable.

The coordinator owns integration conflicts in `src/shared/types/index.ts`, `src/bridge/ipc-bridge.ts`, `test/public-api/exports.ts`, and the README API section. Require the worker to report the exact launch SHA, commits, checks, final status, full diff review, and remaining risks. Remove the worker worktree only after its commits are safely reachable from the retained branch and accepted integration history.

## Deferred backlog

- Any broader 1.0 API audit or additional export removals.
- Moving generator type definitions to a new physical source file.
- Adding new package subpaths or compatibility aliases.

```yaml
review_contract:
  milestone: narrow-public-export-surface
  planning_ref: codex/plan-narrow-public-export-surface
  source_base: "7a47fca6bcd408f50fb7df99e223dfc728f4c28d"
  default_branch: main
  integration_branch: codex/integrate-narrow-public-export-surface
  tasks:
    - id: "01"
      branch: codex/narrow-public-export-surface-01
      depends_on: []
      acceptance: [AC-ROOT, AC-GENERATOR, AC-GUARD, AC-DOCS]
      checks: ["pnpm run test:api", "pnpm run typecheck"]
      delivery: integration-only
      base_policy: latest-default
  integration_checks: ["pnpm run check"]
  e2e_scenarios:
    - "root runtime and Serializable imports compile"
    - "generator types/functions and Rollup option imports compile"
    - "bridge-only type imports from the root fail as expected"
  deferred:
    - "broader 1.0 export audit"
    - "physical generator type reorganization"
    - "new subpaths or compatibility aliases"
```
