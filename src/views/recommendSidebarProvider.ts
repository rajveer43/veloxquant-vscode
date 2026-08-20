import * as vscode from 'vscode';
import { promptSelectInterpreter, resolveInterpreter } from '../python/interpreter';
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

    webview.html = this.renderHtml(webview);

    webview.onDidReceiveMessage((message: { type: string; [key: string]: unknown }) => {
      void this.handleMessage(message);
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = String(Math.random()).slice(2);
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-ui', 'recommend.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview-ui', 'recommend.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VeloxQuant-MLX Recommend</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
${this.bodyHtml(scriptUri, nonce)}
</body>
</html>`;
  }

  private bodyHtml(scriptUri: vscode.Uri, nonce: string): string {
    // The static form markup lives in webview-ui/recommend/index.html at
    // author time; esbuild does not process HTML, so we inline the body
    // markup directly here to keep a single source of truth for the script
    // tag wiring while the form fields are authored in index.html for
    // reference/tests. Both are kept in sync manually (small, stable form).
    return `<div id="app">
  <div id="platform-notice" class="notice notice-warning" hidden></div>

  <form id="recommend-form">
    <fieldset>
      <legend>Chip</legend>
      <div id="chip-group" class="segmented" role="radiogroup" aria-label="Chip">
        <label><input type="radio" name="chip" value="M1" /> M1</label>
        <label><input type="radio" name="chip" value="M2" /> M2</label>
        <label><input type="radio" name="chip" value="M3" /> M3</label>
        <label><input type="radio" name="chip" value="M4" checked /> M4</label>
      </div>
    </fieldset>

    <div class="field">
      <label for="ram-gb">RAM (GB)</label>
      <select id="ram-gb" name="ramGb" required>
        <option value="8">8</option>
        <option value="16" selected>16</option>
        <option value="24">24</option>
        <option value="32">32</option>
        <option value="36">36</option>
        <option value="48">48</option>
        <option value="64">64</option>
        <option value="128">128</option>
      </select>
    </div>

    <div class="field">
      <label for="model-class">Model class</label>
      <select id="model-class" name="modelClass" required>
        <option value="1B">1B</option>
        <option value="3B">3B</option>
        <option value="7B" selected>7B</option>
        <option value="14B">14B</option>
        <option value="32B">32B</option>
      </select>
    </div>

    <div class="field">
      <label for="goal">Goal</label>
      <select id="goal" name="goal" required>
        <option value="everyday" selected>Everyday — safe default, no setup</option>
        <option value="max_key_accounting">Max key accounting — squeeze the key cache hardest</option>
        <option value="max_context">Fit the longest conversation — compress the whole cache</option>
        <option value="best_quality">Best quality — minimize compression side effects</option>
        <option value="constant_memory">Never grow past a fixed memory limit</option>
      </select>
    </div>

    <details id="advanced">
      <summary>Advanced</summary>
      <div class="field">
        <label for="seq-len">Sequence length</label>
        <input type="number" id="seq-len" name="seqLen" min="1" placeholder="default" />
      </div>
      <div class="field">
        <label for="n-layers">Number of layers</label>
        <input type="number" id="n-layers" name="nLayers" min="1" placeholder="default" />
      </div>
      <div class="field">
        <label for="n-kv-heads">KV heads</label>
        <input type="number" id="n-kv-heads" name="nKvHeads" min="1" placeholder="default" />
      </div>
      <div class="field">
        <label for="head-dim">Head dimension</label>
        <input type="number" id="head-dim" name="headDim" min="1" placeholder="default" />
      </div>
    </details>

    <button type="submit" id="submit-btn">Get recommendation</button>
  </form>

  <div id="result" hidden></div>
  <div id="error-area" hidden></div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>`;
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
    terminal.sendText(`${quoteForShell(interpreterPath)} -m pip install VeloxQuant-MLX`);

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
    terminal.sendText(`${quoteForShell(interpreterPath)} -m pip install -U VeloxQuant-MLX`);

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
  };
}

function quoteForShell(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}
