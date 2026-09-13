/**
 * Surfaces `@veloxquant/sdk`'s `benchmark()` (tokens/sec, TTFT, resident-
 * memory comparison) as a one-shot editor action. Reuses the SDK's own
 * `toMarkdown()` formatting rather than reimplementing it, and always
 * includes whatever accounting-only caveat line the SDK produces.
 */
import * as vscode from 'vscode';
import { getVeloxQuantOptions } from '../sdk/client';
import { ensureSdkReady } from '../sdk/versionGate';
import { listLocal } from '../sdk/localModels';
import { listServableMethods } from '../sdk/methods';

export async function runBenchmarkCommand(): Promise<void> {
  if (!(await ensureSdkReady('serve'))) {
    return;
  }

  const modelId = await pickModelId();
  if (!modelId) {
    return;
  }
  const optimizedMethod = await pickOptimizedMethod();
  if (optimizedMethod === undefined) return;

  const outputChannel = vscode.window.createOutputChannel('VeloxQuant-MLX Benchmark');
  outputChannel.show(true);
  outputChannel.appendLine(`Benchmarking ${modelId}…`);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `VeloxQuant-MLX: benchmarking ${modelId}`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: optimizedMethod ? `comparing with ${optimizedMethod}…` : 'selecting an optimized method automatically…' });
        outputChannel.appendLine('[benchmark] loading default method…');

        const { benchmark } = await import('@veloxquant/sdk');
        const result = await benchmark(
          { model: modelId, ...(optimizedMethod ? { optimizedMethod } : {}) },
          await getVeloxQuantOptions()
        );

        outputChannel.appendLine(`[benchmark] complete — ${result.method} vs ${result.optimizedMethodUsed}.`);
        const doc = await vscode.workspace.openTextDocument({
          content: result.toMarkdown(),
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    );
  } catch (err) {
    outputChannel.appendLine(`[benchmark] failed: ${(err as Error).message}`);
    void vscode.window.showErrorMessage(`VeloxQuant-MLX: benchmark failed: ${(err as Error).message}`);
  }
}

async function pickOptimizedMethod(): Promise<string | null | undefined> {
  try {
    const methods = await listServableMethods();
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Automatic recommendation', value: null as string | null, detail: 'Let VeloxQuant select the optimized method.' },
        ...methods.map((method) => ({ label: method.name, value: method.name as string | null, detail: `${method.family} · ${method.blurb}` })),
      ],
      { placeHolder: 'Method to compare with the default' }
    );
    return choice?.value;
  } catch (error) {
    void vscode.window.showErrorMessage(`VeloxQuant-MLX: could not discover serving methods: ${(error as Error).message}`);
    return undefined;
  }
}

async function pickModelId(): Promise<string | undefined> {
  let suggestions: string[] = [];
  try {
    suggestions = (await listLocal()).map((m) => m.id);
  } catch {
    // Fall through to free-text entry below — an empty local model list
    // (or a listing failure) shouldn't block benchmarking a not-yet-
    // downloaded model.
  }

  if (suggestions.length === 0) {
    return vscode.window.showInputBox({
      prompt: 'Model id to benchmark (e.g. mlx-community/Qwen3-8B-4bit)',
      placeHolder: 'org/model-name',
      ignoreFocusOut: true,
    });
  }

  const picked = await vscode.window.showQuickPick([...suggestions, 'Enter a different model id…'], {
    placeHolder: 'Pick a local model to benchmark',
  });
  if (picked === 'Enter a different model id…') {
    return vscode.window.showInputBox({
      prompt: 'Model id to benchmark (e.g. mlx-community/Qwen3-8B-4bit)',
      placeHolder: 'org/model-name',
      ignoreFocusOut: true,
    });
  }
  return picked;
}
