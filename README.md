# VeloxQuant-MLX for VS Code

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

## Links

- Main project: https://github.com/rajveer43/VeloxQuant-MLX
- Issues: https://github.com/rajveer43/veloxquant-vscode/issues

## License

MIT
