/**
 * Minimal WebviewView shown in the Compression Lab's own Activity Bar
 * container. Its only job is discoverability + a launch button that opens
 * the real editor-area WebviewPanel (see playgroundPanel.ts) — the lab
 * itself is deliberately an editor panel, not a sidebar, because it wants
 * width, but the spec calls for its own Activity Bar icon so the feature is
 * discoverable without already knowing the command palette entry exists.
 */
import * as vscode from 'vscode';

export class PlaygroundLauncherProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'veloxquant.playgroundLauncher';

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    const nonce = String(Math.random()).slice(2);
    webviewView.webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px 4px; }
    p { line-height: 1.4; }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; padding: 6px 12px; border-radius: 2px; cursor: pointer; font-weight: 600;
      width: 100%;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  </style>
</head>
<body>
  <p>Run VeloxQuant-MLX's compression lab — try methods and knobs against a real model, locally.</p>
  <button id="open-btn" type="button">Open Compression Lab</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'open' });
    });
  </script>
</body>
</html>`;

    const messageListener = webviewView.webview.onDidReceiveMessage((message: { type: string }) => {
      if (message.type === 'open') {
        void vscode.commands.executeCommand('veloxquant.openPlaygroundEditor');
      }
    });
    webviewView.onDidDispose(() => messageListener.dispose());
  }
}
