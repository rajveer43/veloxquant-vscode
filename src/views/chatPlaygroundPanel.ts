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
import { listServableMethods } from '../sdk/methods';
import { ChatRequestCoordinator } from '../sdk/chatRequestState';
import type { LocalModelsProvider } from './localModelsProvider';

export class ChatPlaygroundPanel {
  private static current: ChatPlaygroundPanel | undefined;

  static hasLoadedModel(): boolean {
    const current = ChatPlaygroundPanel.current;
    return Boolean(current?.session) || current?.modelState === 'loading';
  }

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
  private readonly requests = new ChatRequestCoordinator();
  private agentMode = false;
  private modelState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private modelLoadInFlight = false;
  private disposed = false;

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
    void this.sendMethodList();
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

  private async sendMethodList(): Promise<void> {
    try {
      const methods = await listServableMethods();
      this.post({
        type: 'methods',
        methods: methods.map((method) => ({ name: method.name, family: method.family, blurb: method.blurb })),
      });
    } catch {
      this.post({ type: 'methods', methods: [] });
    }
  }

  private async handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.sendModelList();
        await this.sendMethodList();
        break;
      case 'loadModel':
        await this.handleLoadModel(message.model as string, message.method as string | undefined);
        break;
      case 'setAgentMode':
        if (!this.requests.current) this.agentMode = Boolean(message.enabled);
        break;
      case 'send':
        await this.handleSend(message.prompt as string, message.requestId as string);
        break;
      case 'stopGeneration':
        this.requests.abort(message.requestId as string | undefined);
        break;
      default:
        break;
    }
  }

  private async handleLoadModel(modelId: string, method?: string): Promise<void> {
    if (this.disposed) return;
    if (this.requests.current) {
      this.post({ type: 'error', message: 'Stop the active generation before loading another model.' });
      return;
    }
    if (this.modelLoadInFlight) {
      this.post({ type: 'error', message: 'A model is already loading.' });
      return;
    }
    modelId = modelId.trim();
    if (!modelId) {
      this.post({ type: 'error', message: 'Enter a model id or local path.' });
      return;
    }
    this.modelLoadInFlight = true;
    try {
      if (!(await ensureSdkReady('serve'))) {
        if (!this.disposed) {
          this.post({ type: 'modelState', state: 'error', model: modelId, message: 'VeloxQuant-MLX SDK is not ready.' });
        }
        return;
      }

      this.modelState = 'loading';
      this.post({ type: 'modelState', state: 'loading', model: modelId });
      await this.session?.stop();
      this.session = undefined;

      this.outputChannel = vscode.window.createOutputChannel('VeloxQuant-MLX Chat');
      this.disposables.push(this.outputChannel);
      const session = await ChatSession.load(modelId, method || undefined);
      if (this.disposed) {
        await session.stop();
        return;
      }
      registerEditorTools((spec) => session.registerTool(spec));
      this.session = session;
      this.modelState = 'ready';
      this.outputChannel.appendLine(`[chat] loaded ${modelId} (pid ${session.pid}, method ${session.method})`);
      this.post({ type: 'modelState', state: 'ready', model: modelId, method: session.method });
    } catch (err) {
      this.modelState = 'error';
      if (!this.disposed) {
        this.post({ type: 'modelState', state: 'error', model: modelId, message: (err as Error).message });
      }
    } finally {
      this.modelLoadInFlight = false;
    }
  }

  private async handleSend(prompt: string, requestId: string): Promise<void> {
    if (!this.session) {
      this.post({ type: 'generationFinished', requestId, outcome: 'failed', message: 'No model is loaded yet.' });
      return;
    }
    prompt = prompt.trim();
    if (!prompt) {
      this.post({ type: 'generationFinished', requestId, outcome: 'failed', message: 'Enter a prompt.' });
      return;
    }

    if (this.requests.current) {
      this.post({ type: 'generationFinished', requestId, outcome: 'failed', message: 'A generation is already in progress.' });
      return;
    }

    const id = requestId || `${Date.now()}`;
    const request = this.requests.begin(id);
    if (!request) return;
    const { controller } = request;
    this.post({ type: 'generationStarted', requestId: id });

    try {
      if (this.agentMode) {
        const result = await this.session.runAgent(prompt, controller.signal);
        if (!this.requests.isActive(id)) return;
        for (const step of result.steps) {
          this.post({ type: 'agentStep', requestId: id, toolName: step.toolName, args: step.args, result: step.result });
        }
        this.post({ type: 'assistantChunk', requestId: id, text: result.text, done: true });
      } else {
        for await (const chunk of this.session.stream(prompt, controller.signal)) {
          if (!this.requests.isActive(id)) return;
          this.post({ type: 'assistantChunk', requestId: id, text: chunk.text, done: chunk.done });
          if (chunk.done) break;
        }
      }
      if (this.requests.isActive(id)) {
        this.post({ type: 'generationFinished', requestId: id, outcome: 'completed' });
      }
    } catch (err) {
      if (controller.signal.aborted || !this.requests.isActive(id)) return;
      this.post({
        type: 'generationFinished',
        requestId: id,
        outcome: 'failed',
        message: (err as Error).message,
      });
    } finally {
      const cancelled = controller.signal.aborted;
      const finished = this.requests.finish(id);
      if (cancelled && finished && !this.disposed) {
        this.post({ type: 'generationFinished', requestId: id, outcome: 'cancelled' });
      }
    }
  }

  private async handleDispose(): Promise<void> {
    this.disposed = true;
    ChatPlaygroundPanel.current = undefined;
    this.requests.abort();
    for (const d of this.disposables) {
      d.dispose();
    }
    await this.session?.stop();
    this.session = undefined;
    this.modelState = 'idle';
    void this.getLocalModelsProvider().refresh();
  }
}
