# Contributing to electron-ipc-module

Thanks for helping improve `electron-ipc-module`.

## Development setup

- Use Node.js `>=22.5.0` and pnpm `9.15.9` (Corepack is recommended).
- Install dependencies with `pnpm install --frozen-lockfile`.
- Build the package with `pnpm run build`.

## Making changes

1. Fork the repository and create a focused branch from the default branch.
2. Read the [compatibility contract](README.md#compatibility-contract) and [1.0 stability contract](README.md#10-stability-contract) before changing runtime or module support. ESM-only support, supported Node.js and Electron versions, and public package paths are deliberate boundaries.
3. Keep public API changes intentional: the supported package entry points are documented in the README.
4. Open an issue to discuss a large feature, broad refactor, or API change before investing in a pull request.
5. Add or update tests in `test/` for every behavior change. Keep fixture IPC modules under `test/fixtures/` when testing bridge analysis or generation.
6. Update the README when a user-facing API, option, or workflow changes.

Source code is organized by responsibility:

- `src/runtime/` contains main-process IPC module and container behavior.
- `src/bridge/` contains preload bridge analysis and generation.
- `src/shared/` contains shared types and utilities.

## Quality checks

Run the complete validation suite before opening a pull request:

```bash
pnpm run check
```

Useful individual commands:

```bash
pnpm run test
pnpm run test:watch
pnpm run typecheck
pnpm run lint
pnpm run fmt:check
pnpm run test:api
```

Use `pnpm run fmt` or `pnpm run lint:fix` to apply automatic fixes where appropriate.

## Commits and pull requests

Commits must follow the Conventional Commits format, for example:

```text
feat: add bridge validation hook
fix: preserve listener cleanup order
docs: clarify generator options
```

Keep pull requests small and describe the problem, the solution, and the tests you ran. CI validates commit messages and runs the checks on Node.js 20 and 22 against the supported Electron test matrix.

## Releasing

Releases are automated: release-please opens a release pull request, and merging it publishes to npm from GitHub Actions using trusted publishing, with provenance.

One step is not automated. A prerelease has to publish under some dist-tag or it would take `latest`, so it publishes under `next` — and that tag outlives the line it was created for. Once the stable release ships, `next` still points at the last prerelease, and `npm install electron-ipc-module@next` installs something _older_ than `latest`. After a stable release that followed a prerelease, retire the tag:

```bash
npm dist-tag rm electron-ipc-module next
```

The release workflow prints this as a job warning whenever the tag is still set after a stable release, so it surfaces on the run that created the situation rather than in a document someone has to remember to open.

It cannot do it for you: [trusted publishing](https://docs.npmjs.com/trusted-publishers/#limitations-and-future-improvements) authenticates `npm publish` and `npm stage publish` only, not `npm dist-tag`. Automating the move would mean storing a long-lived npm token as a repository secret — a trade against the reason trusted publishing was adopted in the first place.

## Reporting issues

Please include a minimal reproduction, expected and actual behavior, your Node.js and Electron versions, and any relevant configuration. Do not include secrets, tokens, or private application code.

## License

By contributing, you agree that your contributions are licensed under this repository's MIT License.
