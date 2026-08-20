import * as vscode from 'vscode';
import { RecommendSidebarProvider } from './views/recommendSidebarProvider';
import { PlaygroundPanel } from './views/playgroundPanel';
import { PanelServerManager } from './server/panelServerManager';
import { resolveInterpreter, promptSelectInterpreter } from './python/interpreter';

let serverManager: PanelServerManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const provider = new RecommendSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RecommendSidebarProvider.viewType, provider)
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
