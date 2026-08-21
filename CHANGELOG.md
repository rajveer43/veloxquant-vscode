# Changelog

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
