# Changelog

## [1.0.0](https://github.com/antelm-dev/electron-ipc-module/compare/v0.2.1...v1.0.0) (2026-08-03)


### ⚠ BREAKING CHANGES

* **bridge:** regenerate the bridge after upgrading. Payloads that cannot survive structured clone now fail to compile; each one is a latent runtime bug the previous types concealed. Return plain data or map to a DTO inside the handler.

### Features

* **bridge:** type generated payloads through the structured clone boundary ([d446027](https://github.com/antelm-dev/electron-ipc-module/commit/d446027222250eb97b0487bb56e3b273f25a70af))


### Bug Fixes

* **example:** load the preload under Electron's default sandbox ([5ef9c3d](https://github.com/antelm-dev/electron-ipc-module/commit/5ef9c3d5ca9ae495baddef2d3b0c3fb8c51ff10c))
* sandboxed preload, structured clone types, and the docs that hid both ([e266508](https://github.com/antelm-dev/electron-ipc-module/commit/e266508f589e10b44fd6e96679ca3d7e9a7be698))

## [0.2.1](https://github.com/antelm-dev/electron-ipc-module/compare/v0.2.0...v0.2.1) (2026-08-03)


### Bug Fixes

* **example:** use fileURLToPath for preload and loadFile paths in Electron example app ([d9bb4f2](https://github.com/antelm-dev/electron-ipc-module/commit/d9bb4f2491c8d4ac385f43a7a56da087493bbedc))


### Dependencies

* bump glob from 11.1.0 to 13.0.6 ([#7](https://github.com/antelm-dev/electron-ipc-module/issues/7)) ([6dc1d06](https://github.com/antelm-dev/electron-ipc-module/commit/6dc1d0622b99c39a76513db7dc9745002bfb4324))

## [0.2.0](https://github.com/antelm-dev/electron-ipc-module/compare/v0.1.0...v0.2.0) (2026-07-30)


### Features

* add example Electron application demonstrating typed IPC module usage ([c162719](https://github.com/antelm-dev/electron-ipc-module/commit/c162719c889db84f00e009a4e1dac2ea8ef0e1bb))
