/**
 * Starts and stops `veloxquant vlm-serve` (an OpenAI-style server for
 * vision-language models) and reflects its state in a status bar item.
 * Independent of the Compression Lab panel server.
 */
import { ChildProcess, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { resolveInterpreter, promptSelectInterpreter } from '../python/interpreter';
import { checkModuleImportable } from '../python/recommendClient';
import { listServableMethods } from '../sdk/methods';
import { buildVlmServeArgv, isMlxVlmMissing } from './vlmServerArgs';

type VlmState = 'stopped' | 'starting' | 'running' | 'error';

const DEFAULT_VLM_PORT = 8080;
const POLL_MS = 1000;
const START_TIMEOUT_MS = 10 * 60 * 1000; // first start may download the model

export class VlmServerManager implements vscode.Disposable {
  private child: ChildProcess | undefined;
  private state: VlmState = 'stopped';
  private model = '';
  private port = DEFAULT_VLM_PORT;
  private output = '';
  private readonly channel = vscode.window.createOutputChannel('VeloxQuant-MLX VLM Server');
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);

  constructor() {
    this.item.command = 'veloxquant.stopVlmServer';
  }

  async start(): Promise<void> {
    if (this.child) {
      void vscode.window.showInformationMessage(`VeloxQuant-MLX: VLM server already ${this.state} for ${this.model}.`);
      return;
    }
    const resolution = await resolveInterpreter();
    if (!resolution.path) {
      const choice = await vscode.window.showWarningMessage('VeloxQuant-MLX: no Python interpreter resolved.', 'Select Interpreter');
      if (choice === 'Select Interpreter') await promptSelectInterpreter();
      return;
    }
    if (!(await checkModuleImportable(resolution.path))) {
      void vscode.window.showErrorMessage(`VeloxQuant-MLX is not installed in ${resolution.path}.`);
      return;
    }

    const model = await vscode.window.showInputBox({
      title: 'Start VLM Server',
      prompt: 'Vision-language model (Hugging Face id or local path)',
      placeHolder: 'mlx-community/Qwen2.5-VL-3B-Instruct-4bit',
      ignoreFocusOut: true,
    });
    if (!model?.trim()) return;

    let method: string | undefined;
    try {
      const methods = await listServableMethods();
      const pick = await vscode.window.showQuickPick(
        [{ label: 'Library default', method: undefined as string | undefined }, ...methods.map((m) => ({ label: m.name, description: m.family, method: m.name as string | undefined }))],
        { title: 'KV-cache method', ignoreFocusOut: true }
      );
      if (!pick) return;
      method = pick.method;
    } catch {
      // Method discovery is best-effort; fall back to the library default.
    }

    const configured = vscode.workspace.getConfiguration('veloxquant').get<number>('vlmPort', DEFAULT_VLM_PORT);
    this.port = Number.isInteger(configured) && configured >= 1024 && configured <= 65535 ? configured : DEFAULT_VLM_PORT;
    this.model = model.trim();
    this.output = '';
    const argv = buildVlmServeArgv({ model: this.model, port: this.port, method });
    this.channel.appendLine(`> ${resolution.path} ${argv.join(' ')}`);
    this.channel.show(true);

    const child = spawn(resolution.path, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.setState('starting');
    const onData = (d: Buffer) => {
      const text = d.toString();
      this.output = (this.output + text).slice(-4000);
      this.channel.append(text);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => {
      this.channel.appendLine(`[vlm-serve] failed to start: ${err.message}`);
    });
    child.on('exit', (code) => {
      this.channel.appendLine(`[vlm-serve] exited with code ${code}`);
      const wasStopping = this.child !== child;
      if (this.child === child) this.child = undefined;
      if (wasStopping) return;
      this.setState(code === 0 ? 'stopped' : 'error');
      if (code !== 0) {
        const message = isMlxVlmMissing(this.output)
          ? 'VeloxQuant-MLX: vlm-serve needs mlx-vlm. Install it with: pip install mlx-vlm'
          : `VeloxQuant-MLX: VLM server exited with code ${code}.`;
        void vscode.window.showErrorMessage(message);
      }
    });

    void this.waitUntilHealthy(child);
  }

  private async waitUntilHealthy(child: ChildProcess): Promise<void> {
    const start = Date.now();
    while (this.child === child && Date.now() - start < START_TIMEOUT_MS) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          if (this.child === child) this.setState('running');
          return;
        }
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      void vscode.window.showInformationMessage('VeloxQuant-MLX: no VLM server is running.');
      return;
    }
    this.child = undefined;
    child.kill('SIGTERM');
    this.setState('stopped');
  }

  private setState(state: VlmState): void {
    this.state = state;
    switch (state) {
      case 'stopped':
        this.item.hide();
        return;
      case 'starting':
        this.item.text = '$(sync~spin) VeloxQuant VLM: starting';
        this.item.tooltip = `Loading ${this.model} on port ${this.port}. Click to stop.`;
        break;
      case 'running':
        this.item.text = `$(eye) VeloxQuant VLM:${this.port}`;
        this.item.tooltip = `Serving ${this.model} at http://127.0.0.1:${this.port}. Click to stop.`;
        break;
      case 'error':
        this.item.text = '$(error) VeloxQuant VLM: error';
        this.item.tooltip = 'The VLM server exited with an error. See the output channel.';
        this.item.command = 'veloxquant.startVlmServer';
        this.item.show();
        return;
    }
    this.item.command = 'veloxquant.stopVlmServer';
    this.item.show();
  }

  dispose(): void {
    this.child?.kill('SIGTERM');
    this.child = undefined;
    this.item.dispose();
    this.channel.dispose();
  }
}
