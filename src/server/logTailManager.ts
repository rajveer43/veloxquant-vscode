/**
 * Tails the inference server's logs via `/api/logs?since=` into a dedicated
 * Output Channel. This is distinct from `PanelServerManager`'s own output
 * channel, which only captures the *panel* process's stdout/stderr — the
 * inference server is a subprocess of the panel (spawned by
 * `ServerSupervisor`), so its output is only reachable over this HTTP route,
 * not by the extension directly.
 */
import * as vscode from 'vscode';
import { PanelServerManager } from './panelServerManager';

const POLL_INTERVAL_MS = 2000;

interface LogLine {
  stream: string;
  text: string;
  ts: number;
}

export class LogTailManager implements vscode.Disposable {
  private readonly outputChannel: vscode.OutputChannel;
  private timer: ReturnType<typeof setInterval> | undefined;
  private since = 0;
  private wasActive = false;
  private readonly getManager: () => PanelServerManager | undefined;

  constructor(getManager: () => PanelServerManager | undefined) {
    this.getManager = getManager;
    this.outputChannel = vscode.window.createOutputChannel('VeloxQuant-MLX Inference Server');
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    void this.poll();
  }

  private async poll(): Promise<void> {
    const manager = this.getManager();
    if (!manager) {
      return;
    }

    let status;
    try {
      status = await manager.client.getStatus(2000);
    } catch {
      return;
    }

    const isActive = status.state === 'starting' || status.state === 'running';

    // A fresh start (inactive -> starting/running) means the supervisor
    // cleared its log buffer server-side; reset our offset so we don't
    // request a `since` index past the new buffer's end. Checked before
    // updating `wasActive` so a transient getStatus() failure mid-restart
    // (caught above) can't suppress the reset on the next successful poll.
    if (isActive && !this.wasActive) {
      this.since = 0;
    }
    this.wasActive = isActive;

    if (status.state === 'stopped') {
      return;
    }

    try {
      const { lines } = await manager.client.getLogs(this.since);
      for (const raw of lines as LogLine[]) {
        this.outputChannel.appendLine(`[${raw.stream}] ${raw.text}`);
      }
      this.since += lines.length;
    } catch {
      // Best-effort tail; a transient fetch failure just waits for the next poll.
    }
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.outputChannel.dispose();
  }
}
