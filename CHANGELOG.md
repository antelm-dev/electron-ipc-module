# Changelog

## [0.4.0](https://github.com/antelm-dev/electron-ipc-module/compare/v0.3.0...v0.4.0) (2026-08-10)


### ⚠ BREAKING CHANGES

* **types:** payloads that previously type-checked now fail. A handler returning a class instance with methods, or any object holding a function, symbol, promise, WeakMap, or WeakSet, is rejected at `defineIpcModule` instead of arriving with those members typed `never`. Return plain data or map to a DTO. `Serializable<Buffer>` is now `Uint8Array`, and a custom `Error` subclass is now `Error`, so subclass-only members no longer type-check in the renderer.

### Bug Fixes

* **container:** isolate observer exceptions from lifecycle results ([cac8106](https://github.com/antelm-dev/electron-ipc-module/commit/cac8106fffbb7b17b27fe4d4e5760dc2b74a09b9))
* **container:** isolate observer exceptions from lifecycle results ([4b7155b](https://github.com/antelm-dev/electron-ipc-module/commit/4b7155bb6d3edc2742c1d5b5aa73af2454be91ac)), closes [#22](https://github.com/antelm-dev/electron-ipc-module/issues/22)
* **packaging:** declare typescript as a peer dependency ([3dd39ac](https://github.com/antelm-dev/electron-ipc-module/commit/3dd39acd73be3ed4870bcc22170806231770b2f6)), closes [#19](https://github.com/antelm-dev/electron-ipc-module/issues/19)
* **packaging:** declare typescript as a peer dependency, narrow the Electron support claim ([f6ef31f](https://github.com/antelm-dev/electron-ipc-module/commit/f6ef31fbf1e3492e11f9835cde97c8341b2f9a24))
* **types:** reject a payload whose nested value cannot be cloned ([fc9405f](https://github.com/antelm-dev/electron-ipc-module/commit/fc9405ffb9066736e1ad51fa0b4ab862f09941f3))

## [0.3.0](https://github.com/antelm-dev/electron-ipc-module/compare/v0.2.1...v0.3.0) (2026-08-03)


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
