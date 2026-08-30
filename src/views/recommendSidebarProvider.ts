import * as vscode from 'vscode';
import { promptSelectInterpreter, resolveInterpreter, buildPipInstallCommand } from '../python/interpreter';
import {
  RecommendError,
  RecommendRequestInput,
  checkModuleImportable,
  formatCommandForDisplay,
  getRecommendation,
  buildRecommendArgv,
} from '../python/recommendClient';
import { buildFullSnippet } from '../insert/snippetBuilder';
import { insertSnippet, pickInsertTarget } from '../insert/targetPicker';
import { inferModelShapeFromActiveEditor } from '../insert/modelInference';
import { detectHardware } from '../hardware/detect';
import { PanelApiClient } from '../server/panelApiClient';

const ISSUE_TEMPLATE_URL = 'https://github.com/rajveer43/veloxquant-vscode/issues/new';

export class RecommendSidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'veloxquant.recommendSidebar';

  private view: vscode.WebviewView | undefined;
  private lastCommand: { interpreterPath: string; argv: string[] } | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const webview = webviewView.webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-ui')],
    };

    void this.renderHtml(webview).then((html) => {
      webview.html = html;
    });

    webview.onDidReceiveMessage((message: { type: string; [key: string]: unknown }) => {
      void this.handleMessage(message);
    });
  }

  /**
   * Loads the authored index.html (single source of truth for the form
   * markup — also used by unit/integration tests) and substitutes the
   * webview-safe URIs and CSP nonce placeholders it declares.
   */
  private async renderHtml(webview: vscode.Webview): Promise<string> {
    const nonce = String(Math.random()).slice(2);
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-ui', 'recommend.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-ui', 'recommend.css'));
    const htmlUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-ui', 'recommend.html');

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    const bytes = await vscode.workspace.fs.readFile(htmlUri);
    const body = Buffer.from(bytes)
      .toString('utf8')
      .replace('{{styleUri}}', styleUri.toString())
      .replace('{{scriptUri}}', scriptUri.toString())
      .replace(/\{\{nonce\}\}/g, nonce);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VeloxQuant-MLX Recommend</title>
</head>
<body>
${body}
</body>
</html>`;
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private async handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.handleReady();
        break;
      case 'submit':
        await this.handleSubmit(message.values as RawFormValues);
        break;
      case 'insert':
        await this.handleInsert(message.method as string, message.knobs as Record<string, string | number | boolean>);
        break;
      case 'copyCommand':
        await this.handleCopyCommand();
        break;
      case 'installPackage':
        await this.handleInstallPackage();
        break;
      case 'upgradePackage':
        await this.handleUpgradePackage();
        break;
      case 'selectInterpreter':
        await promptSelectInterpreter();
        break;
      case 'reportIssue':
        await this.handleReportIssue(message.stderr as string);
        break;
      case 'infer':
        this.handleInfer();
        break;
      case 'open':
        void vscode.commands.executeCommand('veloxquant.openPlaygroundEditor');
        break;
      default:
        break;
    }
  }

  private async handleReady(): Promise<void> {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      this.post({ type: 'platformNotice', message: 'VeloxQuant-MLX targets Apple Silicon Macs. Recommendations may not work on this host.' });
    }

    const autoDetect = vscode.workspace.getConfiguration('veloxquant').get<boolean>('autoDetectHardware', true);
    if (autoDetect) {
      const hw = await detectHardware();
      if (hw.chip || hw.ramGb) {
        this.post({ type: 'prefill', values: { chip: hw.chip, ramGb: hw.ramGb } });
      }
    }

    if (inferModelShapeFromActiveEditor()) {
      this.post({ type: 'inferAvailable' });
    }
  }

  private handleInfer(): void {
    const shape = inferModelShapeFromActiveEditor();
    if (!shape) {
      this.post({ type: 'inferResult', values: undefined });
      return;
    }
    this.post({
      type: 'inferResult',
      values: { nLayers: shape.nLayers, headDim: shape.headDim },
      source: shape.source,
    });
  }

  private async resolveInterpreterOrPrompt(): Promise<string | undefined> {
    const resolution = await resolveInterpreter();
    if (!resolution.path) {
      this.post({ type: 'error', kind: 'no-interpreter', message: 'No Python interpreter resolved.' });
      return undefined;
    }
    return resolution.path;
  }

  private async handleSubmit(raw: RawFormValues): Promise<void> {
    const interpreterPath = await this.resolveInterpreterOrPrompt();
    if (!interpreterPath) return;

    const input = toRequestInput(raw);
    this.lastCommand = { interpreterPath, argv: buildRecommendArgv(input) };

    try {
      const response = await getRecommendation(interpreterPath, input);
      const docsUrl = await this.tryResolveDocsUrl(response.recommendation.method);
      this.post({ type: 'result', response, docsUrl });
    } catch (err) {
      if (err instanceof RecommendError) {
        if (err.kind === 'module-not-found') {
          this.post({ type: 'error', kind: 'module-not-found', message: err.message, interpreterPath, stderr: err.stderr });
        } else if (err.kind === 'unsupported-flag') {
          this.post({ type: 'error', kind: 'unsupported-flag', message: err.message, stderr: err.stderr });
        } else {
          // Preflight to distinguish "not importable" from a generic failure
          // when the primary regex match didn't catch it.
          const importable = await checkModuleImportable(interpreterPath);
          if (!importable) {
            this.post({ type: 'error', kind: 'module-not-found', message: 'VeloxQuant-MLX is not importable in this interpreter.', interpreterPath, stderr: err.stderr });
          } else {
            this.post({ type: 'error', kind: 'cli-failed', message: err.message, stderr: err.stderr });
          }
        }
      } else {
        this.post({ type: 'error', kind: 'cli-failed', message: (err as Error).message, stderr: '' });
      }
    }
  }

  /** Uses the local panel server's /api/methods docs_url field when reachable; omits the link otherwise (never guesses a slug). */
  private async tryResolveDocsUrl(method: string): Promise<string | undefined> {
    try {
      const port = vscode.workspace.getConfiguration('veloxquant').get<number>('panelPort', 7860);
      const client = new PanelApiClient(port);
      if (!(await client.isReachable(500))) {
        return undefined;
      }
      const methods = await client.getMethods();
      return methods.methods.find((m) => m.name === method)?.docs_url;
    } catch {
      return undefined;
    }
  }

  private async handleInsert(method: string, knobs: Record<string, string | number | boolean>): Promise<void> {
    const snippet = buildFullSnippet(method, knobs);
    const target = await pickInsertTarget();
    await insertSnippet(target, snippet);
  }

  private async handleCopyCommand(): Promise<void> {
    if (!this.lastCommand) return;
    const text = formatCommandForDisplay(this.lastCommand.interpreterPath, this.lastCommand.argv);
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage('VeloxQuant-MLX command copied to clipboard.');
  }

  private async handleInstallPackage(): Promise<void> {
    const interpreterPath = await this.resolveInterpreterOrPrompt();
    if (!interpreterPath) return;

    const terminal = vscode.window.createTerminal('Install VeloxQuant-MLX');
    terminal.show();
    terminal.sendText(buildPipInstallCommand(interpreterPath, false));

    const disposable = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === terminal) {
        disposable.dispose();
        if (closed.exitStatus?.code === 0) {
          this.post({ type: 'retryReady' });
          void vscode.window.showInformationMessage('VeloxQuant-MLX installed. Retry the recommendation.');
        }
      }
    });
  }

  private async handleUpgradePackage(): Promise<void> {
    const interpreterPath = await this.resolveInterpreterOrPrompt();
    if (!interpreterPath) return;

    const terminal = vscode.window.createTerminal('Upgrade VeloxQuant-MLX');
    terminal.show();
    terminal.sendText(buildPipInstallCommand(interpreterPath, true));

    const disposable = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === terminal) {
        disposable.dispose();
        if (closed.exitStatus?.code === 0) {
          this.post({ type: 'retryReady' });
          void vscode.window.showInformationMessage('VeloxQuant-MLX upgraded. Retry the recommendation.');
        }
      }
    });
  }

  private async handleReportIssue(stderr: string): Promise<void> {
    const body = encodeURIComponent(`**Error output**\n\n\`\`\`\n${stderr}\n\`\`\`\n`);
    await vscode.env.openExternal(vscode.Uri.parse(`${ISSUE_TEMPLATE_URL}?body=${body}`));
  }
}

interface RawFormValues {
  chip: string;
  ramGb: number | string;
  modelClass: string;
  goal: string;
  seqLen?: number;
  nLayers?: number;
  nKvHeads?: number;
  headDim?: number;
  batchSize?: number;
}

function toRequestInput(raw: RawFormValues): RecommendRequestInput {
  return {
    chip: raw.chip as RecommendRequestInput['chip'],
    ramGb: Number(raw.ramGb) as RecommendRequestInput['ramGb'],
    modelClass: raw.modelClass as RecommendRequestInput['modelClass'],
    goal: raw.goal as RecommendRequestInput['goal'],
    seqLen: raw.seqLen,
    nLayers: raw.nLayers,
    nKvHeads: raw.nKvHeads,
    headDim: raw.headDim,
    batchSize: raw.batchSize,
  };
}
