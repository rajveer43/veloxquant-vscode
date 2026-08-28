import * as vscode from 'vscode';
import { RecommendSidebarProvider } from './views/recommendSidebarProvider';
import { PlaygroundPanel } from './views/playgroundPanel';
import { PlaygroundLauncherProvider } from './views/playgroundLauncherProvider';
import { PanelServerManager } from './server/panelServerManager';
import { StatusBarManager } from './server/statusBarManager';
import { LogTailManager } from './server/logTailManager';
import { profileActiveSession } from './server/profileManager';
import { resolveInterpreter, promptSelectInterpreter } from './python/interpreter';

let serverManager: PanelServerManager | undefined;
let statusBarManager: StatusBarManager | undefined;
let logTailManager: LogTailManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
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
    vscode.commands.registerCommand('veloxquant.refreshRecommend', () => {
      // Sidebar re-reads its own state on next 'ready'; nothing to do here
      // beyond exposing the command for discoverability/testing.
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('veloxquant.stopInferenceServer', async () => {
      if (!serverManager) {
        return;
      }

      const running = await serverManager.isInferenceServerRunning();
      if (!running) {
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

  const port = vscode.workspace.getConfiguration('veloxquant').get<number>('panelPort', 7860);
  serverManager = new PanelServerManager(resolution.path, port);
  return serverManager;
}

export async function deactivate(): Promise<void> {
  if (serverManager) {
    await serverManager.dispose();
  }
}
