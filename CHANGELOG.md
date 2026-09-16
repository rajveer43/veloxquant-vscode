# Changelog

## Unreleased

### Features

* add explicit servable-method selection to Chat and Benchmark
* add a worker-backed runtime and Metal diagnostics report
* add schema-validated, cancellable model profiling through the supported `veloxquant profile` CLI

### Bug Fixes

* replace the nonexistent control-panel `/api/profile` integration with the package's profile CLI
* make chat and agent cancellation abort the active HTTP request without stopping the loaded model
* prevent concurrent chat requests and ignore late chunks from cancelled requests
* apply feature-specific Python package version requirements
* update the hosted playground URL and stale method, hardware, and model-management documentation

## [0.5.3](https://github.com/rajveer43/veloxquant-vscode/compare/v0.5.2...v0.5.3) (2026-09-16)


### Bug Fixes

* **recommend:** don't show Upgrade CTA when the install is already current ([95d6bc5](https://github.com/rajveer43/veloxquant-vscode/commit/95d6bc576f3db5068947acbb25c82933814cb07f))
* **recommend:** don't show Upgrade CTA when the install is already current ([b51046f](https://github.com/rajveer43/veloxquant-vscode/commit/b51046f0496b460c7f971086cd8a197df0e95a7c)), closes [#27](https://github.com/rajveer43/veloxquant-vscode/issues/27)
* **recommend:** drop the invalid 256GB RAM tier from the selector ([aaa88d7](https://github.com/rajveer43/veloxquant-vscode/commit/aaa88d75528c453087f6dcb1b09f05a9ea155634))
* **recommend:** drop the invalid 256GB RAM tier from the selector ([52316f8](https://github.com/rajveer43/veloxquant-vscode/commit/52316f85f64cb08fce4cc28b964d97568c9a95b7)), closes [#25](https://github.com/rajveer43/veloxquant-vscode/issues/25)
* **recommend:** remove dead Batch size field with no CLI backing ([cf1acdf](https://github.com/rajveer43/veloxquant-vscode/commit/cf1acdfb3b4796823d617fbb02c3c5427094ae96))
* **recommend:** remove dead Batch size field with no CLI backing ([bb9fb6c](https://github.com/rajveer43/veloxquant-vscode/commit/bb9fb6ca462a0a290164c9bb865fb0567ab5d90d)), closes [#26](https://github.com/rajveer43/veloxquant-vscode/issues/26)
* **recommend:** stop misreporting M5/RAM-tier rejections as "package too old" ([bd52167](https://github.com/rajveer43/veloxquant-vscode/commit/bd5216726a436e0ce469c9d315340d449792af84))
* **recommend:** stop misreporting M5/RAM-tier rejections as "package too old" ([f87fe67](https://github.com/rajveer43/veloxquant-vscode/commit/f87fe67a65c5519b36c598e0ed390c7d11ecbe98)), closes [#24](https://github.com/rajveer43/veloxquant-vscode/issues/24)

## [0.5.2](https://github.com/rajveer43/veloxquant-vscode/compare/v0.5.1...v0.5.2) (2026-09-13)


### Bug Fixes

* **playground:** method discovery, cancellation, and profile CLI integration ([dc9985d](https://github.com/rajveer43/veloxquant-vscode/commit/dc9985de8c7643c34c81914f140eb5174c10af3c))
* **playground:** method discovery, cancellation, and profile CLI integration ([db8c6a0](https://github.com/rajveer43/veloxquant-vscode/commit/db8c6a011494f6d7415f992467f379b5a3618b7b))

## [0.5.1](https://github.com/rajveer43/veloxquant-vscode/compare/v0.5.0...v0.5.1) (2026-09-08)


### Bug Fixes

* **playground:** surface method-discovery failures in the panel webview ([7b86f38](https://github.com/rajveer43/veloxquant-vscode/commit/7b86f389a4feb19b2978a3c528a7e32f206aa1ae))
* **playground:** surface method-discovery failures in the panel webview ([cc6cb52](https://github.com/rajveer43/veloxquant-vscode/commit/cc6cb52e673bb91228add13bc7341548122f860c))

## [0.5.0](https://github.com/rajveer43/veloxquant-vscode/compare/v0.4.3...v0.5.0) (2026-09-08)


### Features

* add SDK-parity Chat Playground, local model management, agent demo, and benchmark command ([3e6ecbd](https://github.com/rajveer43/veloxquant-vscode/commit/3e6ecbdf873ba2cd564d0cd4260a7ebc9b4960c1))

## [0.4.3](https://github.com/rajveer43/veloxquant-vscode/compare/v0.4.2...v0.4.3) (2026-09-03)


### Bug Fixes

* resolve code review findings across panel server lifecycle and API client ([123833d](https://github.com/rajveer43/veloxquant-vscode/commit/123833d1b132ea13d7a25a2aee6f44526c65856b))

## [0.4.2](https://github.com/rajveer43/veloxquant-vscode/compare/v0.4.1...v0.4.2) (2026-09-01)


### Bug Fixes

* address QA report findings and misc panel/status improvements ([915747e](https://github.com/rajveer43/veloxquant-vscode/commit/915747e9d23acf5d499d5c1ab59d634b4d128b20))

## [0.4.1](https://github.com/rajveer43/veloxquant-vscode/compare/v0.4.0...v0.4.1) (2026-08-30)


### Bug Fixes

* move Compression Lab entry point off Recommend panel toolbar ([7926a79](https://github.com/rajveer43/veloxquant-vscode/commit/7926a79f0f3594364bdecb07fd9a5605edd34a23))
* move Compression Lab entry point off Recommend panel toolbar ([82819e8](https://github.com/rajveer43/veloxquant-vscode/commit/82819e880cee4a2de4fc5d8002bcf30ca8fddb5b))

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
