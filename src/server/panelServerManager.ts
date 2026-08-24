/**
 * Manages the local `veloxquant_mlx panel` control-plane server process
 * used to back the Compression Lab webview.
 *
 * Behavior:
 *  - Always checks /api/status before spawning; reuses an already-running
 *    instance instead of spawning a second one.
 *  - Spawns `<interpreter> -m veloxquant_mlx panel --port <port> --no-browser`.
 *  - Tracks the child process handle and kills it on extension deactivation
 *    (but only if *this extension* spawned it — never a pre-existing one).
 */
import { ChildProcess, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { PanelApiClient } from './panelApiClient';
import { checkModuleImportable } from '../python/recommendClient';

export type PanelBackendState = 'unknown' | 'reachable-external' | 'spawning' | 'spawned' | 'unreachable';

/** Thrown by `ensureRunning` when the preflight import check fails, so callers can offer an install action. */
export class PanelModuleNotFoundError extends Error {
  constructor(readonly interpreterPath: string) {
    super(`VeloxQuant-MLX is not installed in the resolved interpreter (${interpreterPath}).`);
    this.name = 'PanelModuleNotFoundError';
  }
}

export class PanelServerManager {
  private child: ChildProcess | undefined;
  private state: PanelBackendState = 'unknown';
  private readonly outputChannel: vscode.OutputChannel;

  constructor(private readonly interpreterPath: string, private readonly port: number) {
    this.outputChannel = vscode.window.createOutputChannel('VeloxQuant-MLX Panel');
  }

  get client(): PanelApiClient {
    return new PanelApiClient(this.port);
  }

  get interpreterPathValue(): string {
    return this.interpreterPath;
  }

  /** True only if this manager instance spawned the currently-tracked child. */
  get spawnedByUs(): boolean {
    return this.child !== undefined && !this.child.killed;
  }

  getState(): PanelBackendState {
    return this.state;
  }

  /**
   * Ensures a panel server is reachable at 127.0.0.1:<port>, reusing one
   * that is already running rather than spawning a duplicate.
   */
  async ensureRunning(timeoutMs = 15000): Promise<void> {
    const client = this.client;

    if (await client.isReachable()) {
      this.state = 'reachable-external';
      return;
    }

    if (this.child && !this.child.killed) {
      // We already have a spawn in flight; just wait for it below.
    } else {
      // Preflight so a missing package produces an actionable "not
      // installed" error instead of a generic "process exited" message.
      const importable = await checkModuleImportable(this.interpreterPath);
      if (!importable) {
        this.state = 'unreachable';
        throw new PanelModuleNotFoundError(this.interpreterPath);
      }

      this.state = 'spawning';
      this.child = spawn(this.interpreterPath, ['-m', 'veloxquant_mlx', 'panel', '--port', String(this.port), '--no-browser'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child.stdout?.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));
      this.child.stderr?.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));
      this.child.on('exit', (code) => {
        this.outputChannel.appendLine(`[veloxquant panel] process exited with code ${code}`);
        this.child = undefined;
        this.state = 'unreachable';
      });
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await client.isReachable()) {
        this.state = 'spawned';
        return;
      }
      if (!this.child || this.child.killed) {
        this.state = 'unreachable';
        throw new Error('VeloxQuant-MLX panel process exited before becoming reachable. Check the output channel for details.');
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    this.state = 'unreachable';
    throw new Error(`Timed out waiting for the VeloxQuant-MLX panel to come up on port ${this.port}.`);
  }

  /**
   * Stops the child process we spawned, if any. Warns (does not silently
   * kill) if the supervised inference server is currently running — the
   * caller is expected to confirm with the user first via
   * `checkInferenceRunningBeforeDispose`.
   */
  async dispose(): Promise<void> {
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = undefined;
  }

  /**
   * Returns true if an inference server is currently running under the
   * panel's supervisor — used as a guardrail before killing our spawned
   * panel process on webview dispose.
   */
  async isInferenceServerRunning(): Promise<boolean> {
    try {
      const status = await this.client.getStatus();
      return status.state === 'running';
    } catch {
      return false;
    }
  }
}
