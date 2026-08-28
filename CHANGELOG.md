# Changelog

## [0.4.0](https://github.com/rajveer43/veloxquant-vscode/compare/v0.3.0...v0.4.0) (2026-08-28)


### Features

* add Profile Active Session command for KVCacheProfiler data ([a43b7a4](https://github.com/rajveer43/veloxquant-vscode/commit/a43b7a40d86b1dbede306e637244e47fa683183e))
* add Profile Active Session command for KVCacheProfiler data ([cc3c74a](https://github.com/rajveer43/veloxquant-vscode/commit/cc3c74ad64ee0bffb37d31a79d83557fc24da988))

## [0.3.0](https://github.com/rajveer43/veloxquant-vscode/compare/v0.2.2...v0.3.0) (2026-08-28)


### Features

* add batch_size and model-shape inference to Recommend sidebar ([f305b2b](https://github.com/rajveer43/veloxquant-vscode/commit/f305b2b4e590f60ca005395c7de1cd4680c437b1)), closes [#8](https://github.com/rajveer43/veloxquant-vscode/issues/8)
* align Recommend sidebar with select_kv_cache_config's WorkloadSpec ([df797a8](https://github.com/rajveer43/veloxquant-vscode/commit/df797a80f9e1f93b2daa222014a64910198cc84a))

## [0.2.2](https://github.com/rajveer43/veloxquant-vscode/compare/v0.2.1...v0.2.2) (2026-08-24)


### Bug Fixes

* fall back to --user --break-system-packages on PEP 668 pip errors ([a1679f3](https://github.com/rajveer43/veloxquant-vscode/commit/a1679f346b10b362519a39b8609d9cf3e7a86e0a))

## [0.2.1](https://github.com/rajveer43/veloxquant-vscode/compare/v0.2.0...v0.2.1) (2026-08-24)


### Bug Fixes

* **playground:** detect missing VeloxQuant-MLX before spawning panel server ([5d071f5](https://github.com/rajveer43/veloxquant-vscode/commit/5d071f5e05a92ed319e1954f8a7bdcda1c1004de))

## [0.2.0](https://github.com/rajveer43/veloxquant-vscode/compare/v0.1.3...v0.2.0) (2026-08-22)


### Features

* add inference server status bar item and live log tailing ([ae38dad](https://github.com/rajveer43/veloxquant-vscode/commit/ae38dad7e8c050be8532bf842cb6448e8e28bfef))
* inference server status bar item + live log tailing ([ef84012](https://github.com/rajveer43/veloxquant-vscode/commit/ef84012406bfdeeecbb1e1900e90e9915e2b1f79))

## [0.1.3](https://github.com/rajveer43/veloxquant-vscode/compare/v0.1.2...v0.1.3) (2026-08-21)


### Bug Fixes

* exclude .claude/ session state from git and packaged .vsix ([ed50848](https://github.com/rajveer43/veloxquant-vscode/commit/ed508481b2a4a41a09841eef8ce03988004d4e1e))

## [0.1.2](https://github.com/rajveer43/veloxquant-vscode/compare/v0.1.1...v0.1.2) (2026-08-21)


### Bug Fixes

* add m5 to Marketplace search keywords ([b5c7e68](https://github.com/rajveer43/veloxquant-vscode/commit/b5c7e6891c145bd1ddc508aaeab3ab7616fbc0e2))
* fold publish job into release-please.yml so tags actually trigger it ([bf5b531](https://github.com/rajveer43/veloxquant-vscode/commit/bf5b5310c39facd65662d8c1bdc905689f981267))

## [0.1.1](https://github.com/rajveer43/veloxquant-vscode/compare/v0.1.0...v0.1.1) (2026-08-21)


### Bug Fixes

* auto-detect M5 chip and support higher RAM steps in Recommend form ([c1fb5d6](https://github.com/rajveer43/veloxquant-vscode/commit/c1fb5d6297ffe2e7156e7ac8a57e1911c0154340))

## 0.1.0

Initial local build.

- Recommend & Insert sidebar: hardware-aware form over `veloxquant_mlx
  recommend --json`, with distinct UI states for not-installed,
  no-interpreter, unsupported-version, non-Darwin, and generic CLI failures.
- Insert-into-editor snippet builder with a target picker across open Python
  files, falling back to clipboard.
- Compression Lab editor panel backed by the local `veloxquant_mlx panel`
  control-plane server, with a hosted-playground fallback opened in the
  system browser.
- Guardrail on Compression Lab dispose: warns before stopping a spawned
  panel process if a real inference server is still running under it.
