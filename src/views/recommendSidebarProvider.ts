import { execFile } from 'node:child_process';
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
import {
  FEATURE_MINIMUMS,
  getInstalledVersion,
  isVersionSupported,
  RECOMMENDED_VERSION,
} from '../python/versionCheck';
import type { PackageFeature } from '../python/versionCheck';
import { AutoRecommendError, getAutoRecommendation } from '../python/autoRecommendClient';
import type { AutoObjective } from '../python/autoRecommendClient';
import { EstimateMemoryError, getMemoryEstimate } from '../python/estimateMemoryClient';
import { PROFILE_HARDWARE_ARGV } from '../hardware/profileHardware';
import { buildFullSnippet } from '../insert/snippetBuilder';
import { insertSnippet, pickInsertTarget } from '../insert/targetPicker';
import { inferModelShapeFromActiveEditor } from '../insert/modelInference';
import { detectHardware } from '../hardware/detect';
import { PanelApiClient, DEFAULT_PANEL_PORT } from '../server/panelApiClient';

const ISSUE_TEMPLATE_URL = 'https://github.com/rajveer43/veloxquant-vscode/issues/new';

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (err, stdout) => {
      if (err && typeof (err as NodeJS.ErrnoException).code === 'string') {
        reject(err);
        return;
      }
      resolve({ stdout, code: err ? ((err as { code?: number }).code ?? 1) : 0 });
    });
  });
}

export class RecommendSidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'veloxquant.recommendSidebar';

  private view: vscode.WebviewView | undefined;
  private lastCommand: { interpreterPath: string; argv: string[] } | undefined;
  private autoAbort: AbortController | undefined;

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
      case 'pickConfig':
        await this.handlePickConfig();
        break;
      case 'submitAuto':
        await this.handleSubmitAuto(message.values as RawAutoValues);
        break;
      case 'cancelAuto':
        this.autoAbort?.abort();
        break;
      case 'estimateMemory':
        await this.handleEstimateMemory(message.values as RawAutoValues);
        break;
      case 'open':
        void vscode.commands.executeCommand('veloxquant.openPlaygroundEditor');
        break;
      default:
        break;
    }
  }

  /**
   * Re-runs the same auto-detect/prefill logic as the initial 'ready'
   * handshake, for the "Refresh Recommendation Form" command. Reveals the
   * sidebar if it isn't visible so the refreshed prefill is actually seen.
   */
  async refresh(): Promise<boolean> {
    if (!this.view) {
      return false;
    }
    this.view.show?.(true);
    await this.handleReady();
    return true;
  }

  private async handleReady(): Promise<void> {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      this.post({ type: 'platformNotice', message: 'VeloxQuant-MLX targets Apple Silicon Macs. Recommendations may not work on this host.' });
    }

    const autoDetect = vscode.workspace.getConfiguration('veloxquant').get<boolean>('autoDetectHardware', true);
    if (autoDetect) {
      const hw = await detectHardware(undefined, () => this.probeHardwareProfile());
      if (hw.chip || hw.ramGb) {
        this.post({ type: 'prefill', values: { chip: hw.chip, ramGb: hw.ramGb }, chipNote: hw.chipNote });
      }
    }

    if (inferModelShapeFromActiveEditor()) {
      this.post({ type: 'inferAvailable' });
    }
  }

  /** stdout of `profile-hardware --json` when the installed package supports it (>= 0.91.0); undefined otherwise so detection falls back to sysctl. */
  private async probeHardwareProfile(): Promise<string | undefined> {
    const resolution = await resolveInterpreter();
    if (!resolution.path) return undefined;
    const version = await getInstalledVersion(resolution.path, execFileAsync);
    if (!version || !isVersionSupported(version, FEATURE_MINIMUMS['profile-hardware'])) return undefined;
    return new Promise((resolve) => {
      execFile(resolution.path as string, PROFILE_HARDWARE_ARGV, { timeout: 15000 }, (err, stdout) => {
        resolve(err ? undefined : stdout);
      });
    });
  }

  /**
   * Returns true when the installed package meets the feature's minimum (or
   * its version can't be determined — the real command then surfaces any
   * error). Otherwise posts a 'feature-needs-upgrade' error and returns false.
   */
  private async ensureFeature(interpreterPath: string, feature: PackageFeature): Promise<boolean> {
    const version = await getInstalledVersion(interpreterPath, execFileAsync);
    const minimum = FEATURE_MINIMUMS[feature];
    if (version && !isVersionSupported(version, minimum)) {
      this.post({ type: 'error', kind: 'feature-needs-upgrade', feature, minimum, version, message: `${feature} needs VeloxQuant-MLX ${minimum} or newer (installed: ${version}).` });
      return false;
    }
    return true;
  }

  private async handlePickConfig(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Select model config.json',
      filters: { 'Model config': ['json'] },
    });
    if (picked?.[0]) {
      this.post({ type: 'configPicked', path: picked[0].fsPath });
    }
  }

  private async handleSubmitAuto(raw: RawAutoValues): Promise<void> {
    const interpreterPath = await this.resolveInterpreterOrPrompt();
    if (!interpreterPath) return;
    if (!raw.modelConfigPath) {
      this.post({ type: 'error', kind: 'cli-failed', message: 'Select a model config.json first.', stderr: '' });
      return;
    }
    if (!(await this.ensureFeature(interpreterPath, 'auto'))) return;

    this.autoAbort?.abort();
    const abort = new AbortController();
    this.autoAbort = abort;
    try {
      const result = await getAutoRecommendation(
        interpreterPath,
        {
          modelConfigPath: raw.modelConfigPath,
          objective: raw.objective as AutoObjective | undefined,
          context: raw.context,
          generation: raw.generation,
          probe: raw.probe,
        },
        abort.signal
      );
      this.post({ type: 'autoResult', result });
    } catch (err) {
      if (err instanceof AutoRecommendError) {
        if (err.kind === 'cancelled') {
          this.post({ type: 'autoCancelled' });
        } else if (err.kind === 'module-not-found') {
          this.post({ type: 'error', kind: 'module-not-found', message: err.message, interpreterPath, stderr: err.stderr });
        } else {
          this.post({ type: 'error', kind: 'cli-failed', message: err.message, stderr: err.stderr });
        }
      } else {
        this.post({ type: 'error', kind: 'cli-failed', message: (err as Error).message, stderr: '' });
      }
    } finally {
      if (this.autoAbort === abort) this.autoAbort = undefined;
    }
  }

  private async handleEstimateMemory(raw: RawAutoValues): Promise<void> {
    const interpreterPath = await this.resolveInterpreterOrPrompt();
    if (!interpreterPath) return;
    if (!raw.modelConfigPath || !raw.context) {
      this.post({ type: 'error', kind: 'cli-failed', message: 'Select a model config.json and set a context length first.', stderr: '' });
      return;
    }
    if (!(await this.ensureFeature(interpreterPath, 'estimate-memory'))) return;
    try {
      const result = await getMemoryEstimate(interpreterPath, { modelConfigPath: raw.modelConfigPath, context: raw.context, top: 5 });
      this.post({ type: 'memoryResult', result });
    } catch (err) {
      const e = err as Partial<EstimateMemoryError>;
      this.post({ type: 'error', kind: 'cli-failed', message: (err as Error).message, stderr: e.stderr ?? '' });
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
          // The regex that classified this as "unsupported-flag" also matches
          // argparse rejecting a value/flag on an up-to-date install (any
          // future case not covered by 'invalid-choice' above). Check the
          // actual installed version before blaming it on being too old —
          // upgrading cannot fix a rejection on an install already at or
          // above the version we recommend.
          const installedVersion = await getInstalledVersion(interpreterPath, execFileAsync);
          if (installedVersion && isVersionSupported(installedVersion, RECOMMENDED_VERSION)) {
            this.post({ type: 'error', kind: 'flag-not-supported', message: err.message, stderr: err.stderr });
          } else {
            this.post({ type: 'error', kind: 'unsupported-flag', message: err.message, stderr: err.stderr });
          }
        } else if (err.kind === 'invalid-choice') {
          this.post({ type: 'error', kind: 'invalid-choice', message: err.message, stderr: err.stderr });
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
      const port = vscode.workspace.getConfiguration('veloxquant').get<number>('panelPort', DEFAULT_PANEL_PORT);
      const client = new PanelApiClient(port);
      if (!(await client.isReachable(500))) {
        return undefined;
      }
      const methods = await client.getMethods();
      return methods.methods.find((m) => m.name === method)?.docs_url ?? undefined;
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
}

interface RawAutoValues {
  modelConfigPath?: string;
  objective?: string;
  context?: number;
  generation?: number;
  probe?: boolean;
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
