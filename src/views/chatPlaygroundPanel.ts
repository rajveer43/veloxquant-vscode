/**
 * Chat Playground: a sibling webview panel to the Compression Lab where a
 * user picks a local model, loads it via `@veloxquant/sdk` (not the CLI),
 * and chats with it, with streaming tokens rendered live — the first place
 * in this extension a model is actually loaded and run through the SDK.
 *
 * Also hosts the Agent-mode demo (Phase 3): a toggle switches between plain
 * chat and `Agent.run()` with the two read-only editor tools from
 * `editorTools.ts`, reusing this same webview/message-list rather than a
 * second parallel chat surface.
 */
import * as vscode from 'vscode';
import { ChatSession } from '../sdk/chatSession';
import { registerEditorTools } from '../sdk/editorTools';
import { ensureSdkReady } from '../sdk/versionGate';
import { listLocal } from '../sdk/localModels';
import type { LocalModelsProvider } from './localModelsProvider';

export class ChatPlaygroundPanel {
  private static current: ChatPlaygroundPanel | undefined;

  static async createOrShow(extensionUri: vscode.Uri, getLocalModelsProvider: () => LocalModelsProvider): Promise<void> {
    if (ChatPlaygroundPanel.current) {
      ChatPlaygroundPanel.current.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel('veloxquant.chatPlayground', 'VeloxQuant-MLX Chat Playground', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview-ui')],
    });

    ChatPlaygroundPanel.current = new ChatPlaygroundPanel(panel, extensionUri, getLocalModelsProvider);
  }

  private disposables: vscode.Disposable[] = [];
  private session: ChatSession | undefined;
  private outputChannel: vscode.OutputChannel | undefined;
  private activeStreamAborted = false;
  private agentMode = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly getLocalModelsProvider: () => LocalModelsProvider
  ) {
    this.panel.webview.html = this.renderHtml();

    this.panel.webview.onDidReceiveMessage((message: { type: string; [key: string]: unknown }) => {
      void this.handleMessage(message);
    }, undefined, this.disposables);

    this.panel.onDidDispose(() => void this.handleDispose(), undefined, this.disposables);

    void this.sendModelList();
  }

  private renderHtml(): string {
    const nonce = String(Math.random()).slice(2);
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-ui', 'chat.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-ui', 'chat.css'));

    const csp = [`default-src 'none'`, `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`].join('; ');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VeloxQuant-MLX Chat Playground</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async sendModelList(): Promise<void> {
    try {
      const models = await listLocal();
      this.post({ type: 'models', models: models.map((m) => m.id) });
    } catch {
      this.post({ type: 'models', models: [] });
    }
  }

  private async handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.sendModelList();
        break;
      case 'loadModel':
        await this.handleLoadModel(message.model as string);
        break;
      case 'setAgentMode':
        this.agentMode = Boolean(message.enabled);
        break;
      case 'send':
        await this.handleSend(message.prompt as string);
        break;
      case 'stopGeneration':
        this.activeStreamAborted = true;
        break;
      default:
        break;
    }
  }

  private async handleLoadModel(modelId: string): Promise<void> {
    if (!(await ensureSdkReady())) {
      this.post({ type: 'modelState', state: 'error', message: 'VeloxQuant-MLX SDK is not ready.' });
      return;
    }

    await this.session?.stop();
    this.session = undefined;

    this.post({ type: 'modelState', state: 'loading', model: modelId });
    this.outputChannel = vscode.window.createOutputChannel('VeloxQuant-MLX Chat');
    this.disposables.push(this.outputChannel);

    try {
      const session = await ChatSession.load(modelId);
      registerEditorTools((spec) => session.registerTool(spec));
      this.session = session;
      this.outputChannel.appendLine(`[chat] loaded ${modelId} (pid ${session.pid}, method ${session.method})`);
      this.post({ type: 'modelState', state: 'ready', model: modelId });
    } catch (err) {
      this.post({ type: 'modelState', state: 'error', message: (err as Error).message });
    }
  }

  private async handleSend(prompt: string): Promise<void> {
    if (!this.session) {
      this.post({ type: 'error', message: 'No model is loaded yet.' });
      return;
    }

    this.activeStreamAborted = false;

    if (this.agentMode) {
      try {
        const result = await this.session.runAgent(prompt);
        for (const step of result.steps) {
          this.post({ type: 'agentStep', toolName: step.toolName, args: step.args, result: step.result });
        }
        this.post({ type: 'assistantChunk', text: result.text, done: true });
      } catch (err) {
        this.post({ type: 'error', message: (err as Error).message });
      }
      return;
    }

    try {
      for await (const chunk of this.session.stream(prompt)) {
        if (this.activeStreamAborted) {
          break;
        }
        this.post({ type: 'assistantChunk', text: chunk.text, done: chunk.done });
        if (chunk.done) {
          break;
        }
      }
    } catch (err) {
      this.post({ type: 'error', message: (err as Error).message });
    }
  }

  private async handleDispose(): Promise<void> {
    ChatPlaygroundPanel.current = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    await this.session?.stop();
    this.session = undefined;
    void this.getLocalModelsProvider().refresh();
  }
}
