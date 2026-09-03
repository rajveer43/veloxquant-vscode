import * as vscode from 'vscode';
import { RecommendSidebarProvider } from './views/recommendSidebarProvider';
import { PlaygroundPanel } from './views/playgroundPanel';
import { PlaygroundLauncherProvider } from './views/playgroundLauncherProvider';
import { PanelServerManager, reapOrphanedPanelProcess } from './server/panelServerManager';
import { DEFAULT_PANEL_PORT } from './server/panelApiClient';
import { StatusBarManager } from './server/statusBarManager';
import { LogTailManager } from './server/logTailManager';
import { profileActiveSession } from './server/profileManager';
import { resolveInterpreter, promptSelectInterpreter } from './python/interpreter';

let serverManager: PanelServerManager | undefined;
let statusBarManager: StatusBarManager | undefined;
let logTailManager: LogTailManager | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
/** Tracks an in-flight `getOrCreateServerManager` call so concurrent callers share one attempt instead of racing to construct duplicate managers. */
let inFlightGetOrCreateServerManager: Promise<PanelServerManager | undefined> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;

  // Best-effort cleanup of a panel process orphaned by a previous session
  // that died without running deactivate() (crash, force-quit, reload).
  void reapOrphanedPanelProcess(context);

  // Belt-and-suspenders: deactivate() doesn't run on a hard crash, but it
  // does run on a normal disable/uninstall — this subscription covers that
  // path even if some other error prevents deactivate() itself from firing.
  context.subscriptions.push({
    dispose: () => {
      void serverManager?.dispose();
    },
  });

  const provider = new RecommendSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RecommendSidebarProvider.viewType, provider)
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PlaygroundLauncherProvider.viewType, new PlaygroundLauncherProvider())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('veloxquant.openPlaygroundEditor', async () => {
      const manager = await getOrCreateServerManager();
      await PlaygroundPanel.createOrShow(context.extensionUri, () => manager);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('veloxquant.refreshRecommend', async () => {
      const refreshed = await provider.refresh();
      if (!refreshed) {
        void vscode.window.showInformationMessage(
          'VeloxQuant-MLX: open the Recommend sidebar first, then refresh.'
        );
        return;
      }
      void vscode.window.showInformationMessage('VeloxQuant-MLX: recommendation form refreshed.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('veloxquant.stopInferenceServer', async () => {
      if (!serverManager) {
        return;
      }

      const state = await serverManager.classifyInferenceServerState();
      if (state === 'error') {
        void vscode.window.showWarningMessage(
          'VeloxQuant-MLX: the inference server is in an error state. Stopping it now.'
        );
      } else if (state !== 'running') {
        void vscode.window.showInformationMessage('VeloxQuant-MLX: no inference server is running.');
        return;
      }

      const choice = await vscode.window.showWarningMessage(
        'Stop the VeloxQuant-MLX inference server? Any in-progress requests will be interrupted.',
        { modal: true },
        'Stop Server'
      );
      if (choice !== 'Stop Server') {
        return;
      }

      try {
        await serverManager.client.stop();
      } catch (err) {
        void vscode.window.showErrorMessage(`Could not stop the VeloxQuant-MLX inference server: ${(err as Error).message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('veloxquant.profileActiveSession', async () => {
      await profileActiveSession(() => serverManager);
    })
  );

  statusBarManager = new StatusBarManager(() => serverManager);
  statusBarManager.start();
  context.subscriptions.push(statusBarManager);

  logTailManager = new LogTailManager(() => serverManager);
  logTailManager.start();
  context.subscriptions.push(logTailManager);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('veloxquant.panelPort')) {
        return;
      }
      void handlePanelPortChanged();
    })
  );
}

/**
 * Reacts to a `veloxquant.panelPort` change made while a panel server is
 * already running. The manager caches its port for its whole lifetime, so a
 * running server on the old port would otherwise stay up, untracked and
 * unreachable via the new setting, until the extension host restarts.
 *
 * We can't safely respawn silently here — a webview may currently be
 * pointed at the old server's URL — so we stop the stale server (if we
 * spawned it and nothing is actively using it) and let the next Compression
 * Lab open pick up the new port via `getOrCreateServerManager()`.
 */
async function handlePanelPortChanged(): Promise<void> {
  if (!serverManager) {
    return;
  }

  // Snapshot and clear the module-level reference before the first await, so
  // a concurrent getOrCreateServerManager() call can't hand out this manager
  // to a new panel while we're about to dispose it (and so it can instead
  // build a fresh manager on the new port right away).
  const manager = serverManager;
  serverManager = undefined;

  const inferenceRunning = await manager.isInferenceServerRunning();
  if (inferenceRunning) {
    // Still in use — put it back so it isn't orphaned/leaked, and leave it
    // running on the old port until the user stops it themselves.
    serverManager = manager;
    void vscode.window.showWarningMessage(
      'VeloxQuant-MLX: "panelPort" changed, but the panel server is still in use (an inference server is running). ' +
        'Stop it and reopen the Compression Lab to apply the new port.'
    );
    return;
  }

  await manager.dispose();
  void vscode.window.showInformationMessage(
    'VeloxQuant-MLX: "panelPort" changed. Reopen the Compression Lab to start the panel server on the new port.'
  );
}

/**
 * Lazily resolves an interpreter and builds the PanelServerManager on first
 * use (only needed by Feature 2 / the Compression Lab command), caching it
 * for the life of the extension host.
 */
async function getOrCreateServerManager(): Promise<PanelServerManager | undefined> {
  if (serverManager) {
    return serverManager;
  }

  if (inFlightGetOrCreateServerManager) {
    return inFlightGetOrCreateServerManager;
  }

  const attempt = getOrCreateServerManagerInternal().finally(() => {
    inFlightGetOrCreateServerManager = undefined;
  });
  inFlightGetOrCreateServerManager = attempt;
  return attempt;
}

async function getOrCreateServerManagerInternal(): Promise<PanelServerManager | undefined> {
  if (serverManager) {
    return serverManager;
  }

  const resolution = await resolveInterpreter();
  if (!resolution.path) {
    const choice = await vscode.window.showWarningMessage(
      'VeloxQuant-MLX: no Python interpreter resolved. Select one to start the Compression Lab.',
      'Select Interpreter'
    );
    if (choice === 'Select Interpreter') {
      await promptSelectInterpreter();
    }
    return undefined;
  }

  const port = resolvePanelPort();
  serverManager = new PanelServerManager(resolution.path, port, extensionContext);
  return serverManager;
}

/**
 * Reads `veloxquant.panelPort` and falls back to the default if it isn't a
 * valid TCP port. The package.json schema constrains this in the Settings
 * UI, but a directly-edited settings.json can still carry an out-of-range,
 * non-integer, or otherwise malformed value.
 */
function resolvePanelPort(): number {
  const configured = vscode.workspace.getConfiguration('veloxquant').get<number>('panelPort', DEFAULT_PANEL_PORT);
  if (Number.isInteger(configured) && configured >= 1024 && configured <= 65535) {
    return configured;
  }

  void vscode.window.showWarningMessage(
    `VeloxQuant-MLX: "veloxquant.panelPort" must be an integer between 1024 and 65535 (got ${configured}). Using the default port ${DEFAULT_PANEL_PORT} instead.`
  );
  return DEFAULT_PANEL_PORT;
}

export async function deactivate(): Promise<void> {
  if (serverManager) {
    await serverManager.dispose();
  }
}
