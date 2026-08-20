import * as vscode from 'vscode';
import { PanelServerManager } from '../server/panelServerManager';

const HOSTED_PLAYGROUND_URL = 'https://veloxquant-mlx.netlify.app/playground.html';

export class PlaygroundPanel {
  private static current: PlaygroundPanel | undefined;

  static async createOrShow(
    extensionUri: vscode.Uri,
    getServerManager: () => PanelServerManager | undefined
  ): Promise<void> {
    if (PlaygroundPanel.current) {
      PlaygroundPanel.current.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel('veloxquant.playground', 'VeloxQuant-MLX Compression Lab', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview-ui')],
    });

    PlaygroundPanel.current = new PlaygroundPanel(panel, extensionUri, getServerManager);
  }

  private disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly getServerManager: () => PanelServerManager | undefined
  ) {
    this.panel.webview.html = this.renderHtml();

    this.panel.webview.onDidReceiveMessage((message: { type: string }) => {
      void this.handleMessage(message);
    }, undefined, this.disposables);

    this.panel.onDidDispose(() => void this.handleDispose(), undefined, this.disposables);
  }

  private renderHtml(): string {
    const nonce = String(Math.random()).slice(2);
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-ui', 'playground.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-ui', 'playground.css'));

    const port = vscode.workspace.getConfiguration('veloxquant').get<number>('panelPort', 7860);
    const originSource = `http://127.0.0.1:${port}`;

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `frame-src ${originSource}`,
      `connect-src ${originSource}`,
    ].join('; ');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VeloxQuant-MLX Compression Lab</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async handleMessage(message: { type: string }): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.startLocalBackend();
        break;
      case 'retry':
        await this.startLocalBackend();
        break;
      case 'openHosted':
        await vscode.env.openExternal(vscode.Uri.parse(HOSTED_PLAYGROUND_URL));
        break;
      default:
        break;
    }
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async startLocalBackend(): Promise<void> {
    this.post({ type: 'loading' });
    const manager = this.getServerManager();
    if (!manager) {
      this.post({
        type: 'unavailable',
        message: 'Could not resolve a Python interpreter to start the local compression lab server.',
      });
      return;
    }

    try {
      await manager.ensureRunning();
      this.post({ type: 'ready', url: manager.client.baseUrl() });
    } catch (err) {
      this.post({
        type: 'unavailable',
        message: `Could not reach the local VeloxQuant-MLX panel server: ${(err as Error).message}`,
      });
    }
  }

  private async handleDispose(): Promise<void> {
    PlaygroundPanel.current = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }

    const manager = this.getServerManager();
    if (!manager || !manager.spawnedByUs) {
      return;
    }

    const inferenceRunning = await manager.isInferenceServerRunning();
    if (inferenceRunning) {
      const choice = await vscode.window.showWarningMessage(
        'An inference server started from the Compression Lab is still running. Stop the panel server and the inference server too?',
        { modal: false },
        'Stop both',
        'Leave running'
      );
      if (choice !== 'Stop both') {
        return;
      }
      try {
        await manager.client.stop();
      } catch {
        // best-effort; still proceed to dispose the panel process below
      }
    }

    await manager.dispose();
  }
}
