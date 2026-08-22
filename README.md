<p align="center">
  <img src="media/icon.png" alt="VeloxQuant-MLX icon" width="128" height="128" />
</p>

# VeloxQuant-MLX for VS Code

[![VS Code Marketplace Version](https://img.shields.io/vscode-marketplace/v/veloxquant-mlx.veloxquant-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=veloxquant-mlx.veloxquant-vscode)
[![VS Code Marketplace Installs](https://img.shields.io/vscode-marketplace/i/veloxquant-mlx.veloxquant-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=veloxquant-mlx.veloxquant-vscode)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/veloxquant-mlx/veloxquant-vscode)](https://open-vsx.org/extension/veloxquant-mlx/veloxquant-vscode)
[![Open VSX Version](https://img.shields.io/open-vsx/v/veloxquant-mlx/veloxquant-vscode)](https://open-vsx.org/extension/veloxquant-mlx/veloxquant-vscode)

Recommend a KV-cache compression method for your Mac and model, and run the
[VeloxQuant-MLX](https://github.com/rajveer43/VeloxQuant-MLX) compression lab
— without leaving VS Code.

[VeloxQuant-MLX](https://github.com/rajveer43/VeloxQuant-MLX) shrinks the KV
cache of `mlx_lm` models on Apple Silicon, up to 16x, via 42 compression
methods behind one API. This extension is a thin client over the package's
own `recommend` CLI and local control-plane server — it does not reimplement
any compression logic.

## Features

### Recommend & Insert

A dedicated sidebar (its own Activity Bar icon) with a form for chip, RAM,
model class, and goal. Submitting it runs
`python -m veloxquant_mlx recommend --json` using whichever interpreter is
selected in the Python extension (or `veloxquant.pythonPath` if you set one),
and renders:

- The recommended method, headline compression ratio, and — just as
  prominently — whether that compression is likely to show up as **lower
  live RAM usage** or is **accounting-only** (many methods still materialize
  full-precision tensors internally; the package's own docs are explicit
  about this, and this extension will not round that nuance off).
- Warnings and rationale straight from the CLI.
- An **Insert into editor** button that writes a ready-to-use
  `KVCacheConfig(...)` snippet at your cursor (or offers a picker across
  open Python files, or falls back to your clipboard).
- A **Copy CLI command** button so you can reproduce the exact call in a
  terminal or notebook.

Hardware detection (chip + RAM) prefills the form on Apple Silicon Macs when
`veloxquant.autoDetectHardware` is on; it never blocks the form if detection
fails.

### Compression Lab

Command **VeloxQuant-MLX: Open Compression Lab**, or its own Activity Bar
icon. Opens an editor-area panel backed by the package's own local
control-plane server (`python -m veloxquant_mlx panel --port <port>
--no-browser`), reusing an already-running instance instead of spawning a
duplicate. If the local package isn't available, a **Use hosted version
instead** button opens the hosted playground in your system browser.

The local server can also start/stop a real `mlx_lm` inference process. If
this extension spawned the panel process and an inference server is still
running when you close the Compression Lab panel, you'll be asked before
anything is stopped.

While an inference server started from the Compression Lab is running, a
status bar item shows its method and port. Hovering it also shows the
server process's measured RSS (via the control panel's `/api/memory`,
clearly separate from the accounting-only compression ratios shown
elsewhere), and it links to command **VeloxQuant-MLX: Stop Inference
Server**. Clicking the item reopens the Compression Lab panel. The
server's stdout/stderr are also tailed live into an output channel named
**VeloxQuant-MLX Inference Server** (View → Output), separate from the
**VeloxQuant-MLX Panel** channel, which only carries the control-plane
process's own logs.

## Requirements

- macOS on Apple Silicon (M1–M4) to actually run compression — the
  extension activates cross-platform (e.g. over Remote-SSH into a Mac) but
  will show an upfront notice rather than pretend the library works
  elsewhere.
- Python with `VeloxQuant-MLX` installed, resolved via the
  [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
  or `veloxquant.pythonPath`.
- **VeloxQuant-MLX 0.42.0 or newer** — this is the minimum version that
  supports `recommend --json`. Older installs get a distinct "please
  upgrade" message rather than a generic failure.

Install the package:

```
pip install VeloxQuant-MLX
```

(The extension can also do this for you from an inline "Install
VeloxQuant-MLX" button when it detects the package is missing.)

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `veloxquant.pythonPath` | `""` | Explicit interpreter path. Leave blank to use the Python extension's active interpreter. |
| `veloxquant.panelPort` | `7860` | Port for the local control-plane server. Always loopback (`127.0.0.1`) — there is no setting to change that host. |
| `veloxquant.autoDetectHardware` | `true` | Prefill chip/RAM in the Recommend form from detected hardware. |

## Not (yet) included

- No CodeLens/hover/IntelliSense on `KVCacheConfig(...)` call sites, no
  custom language server.
- No bundling of the `VeloxQuant-MLX` Python package inside the extension —
  this is a thin client over a user-managed Python environment.
- No model download manager.
- No account system, no non-standard telemetry (VS Code's own opt-in/opt-out
  telemetry API only).
- No Windows/Linux feature parity claims — the extension can activate
  cross-platform but does not claim the underlying library works there.
- Demo GIF: TODO.

## Development

```
npm install
npm run compile      # type check
npm run lint
npm run test:unit    # node:test, pure logic (snippet builder, argv building, version check)
npm run build        # esbuild bundle to dist/
npm run test:integration  # @vscode/test-electron, spins up a real VS Code instance
npm run package       # vsce package (dry run, does not publish)
```

`test:integration` launches a real Electron-based VS Code instance and will
not run in a headless/sandboxed shell without GUI session access (it needs
window server access on macOS or a virtual display like Xvfb on Linux CI).
The scaffolding under `test/suite/` is real and passes locally in a normal
desktop terminal; it is pinned to VS Code 1.85.2 for launcher compatibility.

## Releasing

Normal releases are fully automated — see [CONTRIBUTING.md](CONTRIBUTING.md).
Merging Conventional Commits into `master` lets
[release-please](https://github.com/googleapis/release-please) open a
Release PR; merging that PR tags, builds, and publishes to both the VS Code
Marketplace and Open VSX automatically via
[`.github/workflows/release-please.yml`](.github/workflows/release-please.yml).

The steps below are for the rare case you need to publish by hand (e.g. the
CI publish job failed partway and a version is already live on one
registry, or a registry needs one-time setup).

### One-time setup

Both `vsce` and `ovsx` read their token from the `-p` flag. Export them as
env vars locally so you never have to type them inline:

```
export VSCE_PAT=<Azure DevOps PAT, Marketplace scope = Manage>
export OVSX_PAT=<Open VSX access token, from open-vsx.org -> Profile -> Access Tokens>
```

Open VSX also requires the publisher namespace to exist before the first
publish — this is separate from having a valid token:

```
npx ovsx create-namespace veloxquant-mlx -p "$OVSX_PAT"
```

(Safe to re-run — it errors with "Namespace already exists" if already
created, which is fine.)

### Build the package

From `master`, at the commit/tag you want to publish:

```
npm ci
npm run build
npx vsce package --no-dependencies -o release.vsix
```

### Publish

```
npx vsce publish --packagePath release.vsix -p "$VSCE_PAT"
npx ovsx publish release.vsix -p "$OVSX_PAT"
```

`vsce publish` is not idempotent — it fails loudly (`vX.Y.Z already exists`)
if that exact version is already live on the Marketplace. If Marketplace
succeeded but Open VSX didn't (or vice versa), just re-run the one that
still needs it.

### Attach the `.vsix` to the GitHub Release

```
gh release upload vX.Y.Z release.vsix --repo rajveer43/veloxquant-vscode
```

Replace `vX.Y.Z` with the tag release-please already created for that
version (the release must exist first — release-please creates it when its
PR is merged).

**Never paste a real token value into a chat/AI assistant, a commit, or any
file that gets committed.** If a token is ever exposed that way, revoke it
immediately on open-vsx.org / Azure DevOps and update the corresponding
GitHub Actions secret (`OVSX_PAT` / `VSCE_PAT`).

## Links

- Main project: https://github.com/rajveer43/VeloxQuant-MLX
- Issues: https://github.com/rajveer43/veloxquant-vscode/issues
- VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=veloxquant-mlx.veloxquant-vscode
- Open VSX Registry: https://open-vsx.org/extension/veloxquant-mlx/veloxquant-vscode

## License

MIT
