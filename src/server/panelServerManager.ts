/**
 * Manages the local `veloxquant_mlx panel` control-plane server process
 * used to back the Compression Lab webview.
 *
 * Behavior:
 *  - Always checks /api/status before spawning; reuses an already-running
 *    instance instead of spawning a second one.
 *  - Spawns `<interpreter> -m veloxquant_mlx panel --port <port> --no-browser`
 *    detached, in its own process group, so it can be reliably signaled by
 *    PID even after the extension host that spawned it is gone.
 *  - Tracks the child process handle and kills it on extension deactivation
 *    (but only if *this extension* spawned it — never a pre-existing one).
 *  - Persists the spawned PID/port to `globalState` so that if the extension
 *    host dies abnormally (crash, force-quit, window reload) without running
 *    `deactivate()`, the next activation can detect and reap the orphaned
 *    process instead of leaking it forever.
 */
import { ChildProcess, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { PanelApiClient, StatusResponse } from './panelApiClient';
import { checkModuleImportable } from '../python/recommendClient';
import { validateInterpreterPath } from '../python/interpreter';

export type PanelBackendState = 'unknown' | 'reachable-external' | 'spawning' | 'spawned' | 'unreachable';

interface TrackedPanelProcess {
  pid: number;
  port: number;
}

const TRACKED_PROCESS_KEY = 'veloxquant.panelServer.trackedProcess';

/** True if a process with this PID currently exists (POSIX/Windows-safe probe via signal 0). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reaps a panel process left behind by a previous extension host session
 * that died before it could call `dispose()` (crash, force-quit, window
 * reload). Called once at activation, before any new process is spawned.
 */
export async function reapOrphanedPanelProcess(context: vscode.ExtensionContext): Promise<void> {
  const tracked = context.globalState.get<TrackedPanelProcess>(TRACKED_PROCESS_KEY);
  if (!tracked) {
    return;
  }

  // Guard against PID reuse: only kill if the tracked PID is alive *and* the
  // tracked port is actually answering as a VeloxQuant-MLX panel. Without
  // this, an OS that reassigns the stale PID to an unrelated process group
  // after an unclean exit would have its whole group killed by SIGTERM.
  if (isPidAlive(tracked.pid) && (await new PanelApiClient(tracked.port).isReachable())) {
    try {
      // Negative PID targets the whole process group we detached it into,
      // so any children the panel itself spawned are cleaned up too.
      process.kill(-tracked.pid, 'SIGTERM');
    } catch {
      try {
        process.kill(tracked.pid, 'SIGTERM');
      } catch {
        // Already gone.
      }
    }
  }

  await context.globalState.update(TRACKED_PROCESS_KEY, undefined);
}

/** Thrown by `ensureRunning` when the preflight import check fails, so callers can offer an install action. */
export class PanelModuleNotFoundError extends Error {
  constructor(readonly interpreterPath: string) {
    super(`VeloxQuant-MLX is not installed in the resolved interpreter (${interpreterPath}).`);
    this.name = 'PanelModuleNotFoundError';
  }
}

/** Thrown by `ensureRunning` when the configured/resolved interpreter path itself is invalid. */
export class PanelInterpreterInvalidError extends Error {
  constructor(readonly interpreterPath: string, reason: string) {
    super(reason);
    this.name = 'PanelInterpreterInvalidError';
  }
}

export class PanelServerManager {
  private child: ChildProcess | undefined;
  private state: PanelBackendState = 'unknown';
  private readonly outputChannel: vscode.OutputChannel;
  /** Tracks an in-flight `ensureRunning` call so concurrent callers share one attempt instead of racing to spawn. */
  private inFlightEnsureRunning: Promise<void> | undefined;

  constructor(
    private readonly interpreterPath: string,
    private readonly port: number,
    private readonly context?: vscode.ExtensionContext
  ) {
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
   *
   * Concurrent calls (e.g. the webview firing overlapping 'ready'/'retry'
   * messages) share a single in-flight attempt rather than each racing
   * through the "not yet running" branch and double-spawning before either
   * has assigned `this.child`.
   */
  async ensureRunning(timeoutMs = 15000): Promise<void> {
    if (this.inFlightEnsureRunning) {
      return this.inFlightEnsureRunning;
    }

    const attempt = this.ensureRunningInternal(timeoutMs).finally(() => {
      this.inFlightEnsureRunning = undefined;
    });
    this.inFlightEnsureRunning = attempt;
    return attempt;
  }

  private async ensureRunningInternal(timeoutMs: number): Promise<void> {
    const client = this.client;

    if (await client.isReachable()) {
      this.state = 'reachable-external';
      return;
    }

    if (this.child && !this.child.killed) {
      // We already have a spawn in flight; just wait for it below.
    } else {
      // Preflight the interpreter path itself so a bad path produces a
      // clear "invalid interpreter" error instead of being misattributed
      // to a missing package below.
      const pathError = await validateInterpreterPath(this.interpreterPath);
      if (pathError) {
        this.state = 'unreachable';
        throw new PanelInterpreterInvalidError(this.interpreterPath, pathError);
      }

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
        // Detached + own process group so the panel (and anything it
        // spawns) survives independently of this extension host and can be
        // signaled by PID/PGID from a later session if we die uncleanly.
        detached: true,
      });
      this.child.unref();
      if (this.child.pid !== undefined) {
        void this.context?.globalState.update(TRACKED_PROCESS_KEY, { pid: this.child.pid, port: this.port } satisfies TrackedPanelProcess);
      }
      this.child.stdout?.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));
      this.child.stderr?.on('data', (d: Buffer) => this.outputChannel.append(d.toString()));
      this.child.on('exit', (code) => {
        this.outputChannel.appendLine(`[veloxquant panel] process exited with code ${code}`);
        this.child = undefined;
        this.state = 'unreachable';
        void this.context?.globalState.update(TRACKED_PROCESS_KEY, undefined);
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
   * Stops the child process we spawned, if any. Does not check whether the
   * supervised inference server is currently running — callers that need to
   * warn/confirm with the user first must check `isInferenceServerRunning()`
   * (or `getInferenceServerState()`) themselves before calling this, as
   * `extension.ts`'s `handlePanelPortChanged` and `playgroundPanel.ts`'s
   * `handleDispose` do.
   */
  async dispose(): Promise<void> {
    if (this.child && !this.child.killed) {
      if (this.child.pid !== undefined) {
        try {
          // Kill the detached process group, not just the immediate child,
          // so anything the panel itself spawned goes down too.
          process.kill(-this.child.pid, 'SIGTERM');
        } catch {
          this.child.kill();
        }
      } else {
        // No PID assigned (e.g. spawn failed before the OS assigned one) —
        // still attempt cleanup on the child handle itself.
        this.child.kill();
      }
    }
    this.child = undefined;
    await this.context?.globalState.update(TRACKED_PROCESS_KEY, undefined);
  }

  /**
   * Returns true if an inference server is currently running under the
   * panel's supervisor — used as a guardrail before killing our spawned
   * panel process on webview dispose.
   */
  async isInferenceServerRunning(): Promise<boolean> {
    return (await this.classifyInferenceServerState()) === 'running';
  }

  /**
   * Returns the raw inference server state (including 'error'), or
   * undefined if the status endpoint couldn't be reached at all. Callers
   * that need to distinguish "errored" from "genuinely not running" should
   * use this instead of the running/not-running boolean.
   */
  async getInferenceServerState(): Promise<StatusResponse['state'] | undefined> {
    try {
      const status = await this.client.getStatus();
      return status.state;
    } catch {
      return undefined;
    }
  }

  /**
   * Collapses the raw inference server state into the three buckets that
   * every caller needing to warn/act on it branches on: a crashed server
   * ('error'), a live one ('running'), or anything else — stopped, starting,
   * or unreachable — treated as idle. Callers that need the raw state (e.g.
   * to show `status.error` detail) should still use `getInferenceServerState`.
   */
  async classifyInferenceServerState(): Promise<'error' | 'running' | 'idle'> {
    const state = await this.getInferenceServerState();
    if (state === 'error') {
      return 'error';
    }
    return state === 'running' ? 'running' : 'idle';
  }
}
