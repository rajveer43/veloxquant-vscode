/**
 * Persistent status bar item for the inference server started from the
 * Compression Lab (`veloxquant serve`, supervised by the panel's
 * `ServerSupervisor`). Polls the same `/api/status` the panel webview
 * already relies on — no new Python surface.
 *
 * Only shown while `PanelServerManager` exists (i.e. the Compression Lab
 * has been opened at least once this session) and the supervised server is
 * `starting`, `running`, or `error`. Hidden when `stopped` so it does not
 * imply a server is available before one has ever been started.
 */
import * as vscode from 'vscode';
import { PanelServerManager } from './panelServerManager';
import { StatusResponse } from './panelApiClient';
import { formatBytes } from './format';

const POLL_INTERVAL_MS = 5000;

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly getManager: () => PanelServerManager | undefined;

  constructor(getManager: () => PanelServerManager | undefined) {
    this.getManager = getManager;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'veloxquant.openPlaygroundEditor';
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const manager = this.getManager();
    if (!manager) {
      this.item.hide();
      return;
    }

    let status: StatusResponse;
    try {
      status = await manager.client.getStatus(2000);
    } catch {
      this.item.hide();
      return;
    }

    if (status.state === 'stopped') {
      this.item.hide();
      return;
    }

    if (status.state === 'error') {
      this.item.text = '$(error) VeloxQuant-MLX: error';
      const detail = status.error ? `: ${status.error}` : '';
      this.item.tooltip = `VeloxQuant-MLX inference server failed${detail}. Click to open the Compression Lab.`;
      this.item.show();
      return;
    }

    const method = typeof status.config.method === 'string' && status.config.method ? status.config.method : undefined;
    const rawPort = status.config.port;
    const port =
      typeof rawPort === 'number' ? String(rawPort) : typeof rawPort === 'string' && rawPort ? rawPort : undefined;

    if (status.state === 'starting') {
      this.item.text = '$(sync~spin) VeloxQuant-MLX: starting';
      this.item.tooltip = 'VeloxQuant-MLX inference server is starting. Click to open the Compression Lab.';
      this.item.show();
      return;
    }

    let label = method ?? '';
    if (port) {
      label += `:${port}`;
    }
    this.item.text = `$(zap) VeloxQuant-MLX${label ? `: ${label}` : ''}`;
    this.item.tooltip = await this.buildTooltip(manager, method, port);
    this.item.show();
  }

  private async buildTooltip(
    manager: PanelServerManager,
    method: string | undefined,
    port: string | undefined
  ): Promise<vscode.MarkdownString> {
    const lines: string[] = ['**VeloxQuant-MLX inference server**', ''];
    if (method) {
      lines.push(`Method: \`${method}\``);
    }
    if (port) {
      lines.push(`Port: ${port}`);
    }

    try {
      const memory = await manager.client.getMemory();
      const process = memory.process as { rss_bytes?: number | null; unavailable_reason?: string | null } | undefined;
      if (process?.rss_bytes != null) {
        lines.push(`Server RSS: ${formatBytes(process.rss_bytes)}`);
      } else if (process?.unavailable_reason) {
        lines.push(`Server RSS: unavailable (${process.unavailable_reason})`);
      }
      const note = typeof memory.note === 'string' ? memory.note : undefined;
      if (note) {
        lines.push('', note);
      }
    } catch {
      // Memory endpoint is best-effort for the tooltip; omit the section on failure.
    }

    lines.push(
      '',
      'Click to open the Compression Lab. [Profile session](command:veloxquant.profileActiveSession) · [Stop server](command:veloxquant.stopInferenceServer)'
    );

    const md = new vscode.MarkdownString(lines.join('\n'));
    md.isTrusted = { enabledCommands: ['veloxquant.profileActiveSession', 'veloxquant.stopInferenceServer'] };
    return md;
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.item.dispose();
  }
}
