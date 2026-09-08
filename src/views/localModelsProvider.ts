/**
 * TreeView listing locally-cached model weights (id, size, last-used) with
 * pull/delete actions. A TreeDataProvider rather than a webview: this is a
 * plain sortable list with per-row actions, and TreeView gets VS Code's
 * built-in list chrome, context-menu actions, and keyboard nav for free —
 * none of the existing webview machinery is a good fit here.
 */
import * as vscode from 'vscode';
import type { LocalModel } from '@veloxquant/sdk' with { 'resolution-mode': 'require' };
import { listLocal, pullLocal, deleteLocal } from '../sdk/localModels';
import { formatBytes } from '../server/format';
import { ensureSdkReady } from '../sdk/versionGate';

class LocalModelItem extends vscode.TreeItem {
  constructor(readonly model: LocalModel) {
    super(model.id, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'localModel';
    this.description = formatBytes(model.sizeBytes);
    this.tooltip = model.lastUsedAt
      ? `${model.id}\nLast used: ${model.lastUsedAt.toLocaleString()}`
      : `${model.id}\nLast used: unknown`;
    this.iconPath = new vscode.ThemeIcon('package');
  }
}

export class LocalModelsProvider implements vscode.TreeDataProvider<LocalModelItem> {
  static readonly viewType = 'veloxquant.localModels';

  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private models: LocalModel[] | undefined;

  getTreeItem(element: LocalModelItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<LocalModelItem[]> {
    if (!this.models) {
      await this.refresh();
    }
    return (this.models ?? []).map((m) => new LocalModelItem(m));
  }

  async refresh(): Promise<void> {
    if (!(await ensureSdkReady())) {
      this.models = [];
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }

    try {
      this.models = await listLocal();
    } catch (err) {
      this.models = [];
      void vscode.window.showErrorMessage(`VeloxQuant-MLX: could not list local models: ${(err as Error).message}`);
    }
    this.onDidChangeTreeDataEmitter.fire();
  }
}

/** Prompts for a Hugging Face model id and pulls it, showing indeterminate progress (pulls can take many minutes). */
export async function pullModelCommand(provider: LocalModelsProvider): Promise<void> {
  if (!(await ensureSdkReady())) {
    return;
  }

  const modelId = await vscode.window.showInputBox({
    prompt: 'Hugging Face model id to download (e.g. mlx-community/Qwen3-8B-4bit)',
    placeHolder: 'org/model-name',
    ignoreFocusOut: true,
  });
  if (!modelId) {
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `VeloxQuant-MLX: downloading ${modelId}`,
        cancellable: false,
      },
      () => pullLocal(modelId)
    );
    void vscode.window.showInformationMessage(`VeloxQuant-MLX: downloaded ${modelId}.`);
  } catch (err) {
    void vscode.window.showErrorMessage(`VeloxQuant-MLX: could not download "${modelId}": ${(err as Error).message}`);
  } finally {
    await provider.refresh();
  }
}

/** Deletes a model's cached weights after an explicit confirmation — at least as destructive/irreversible as stopping the inference server, which already requires confirmation. */
export async function deleteModelCommand(provider: LocalModelsProvider, item: LocalModelItem | undefined): Promise<void> {
  if (!item) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Delete the cached weights for "${item.model.id}"? This frees disk space but cannot be undone from within VS Code — you would need to re-download the model.`,
    { modal: true },
    'Delete'
  );
  if (choice !== 'Delete') {
    return;
  }

  try {
    const result = await deleteLocal(item.model.id);
    void vscode.window.showInformationMessage(
      `VeloxQuant-MLX: deleted "${item.model.id}", freed ${formatBytes(result.freedBytes)}.`
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`VeloxQuant-MLX: could not delete "${item.model.id}": ${(err as Error).message}`);
  } finally {
    await provider.refresh();
  }
}
