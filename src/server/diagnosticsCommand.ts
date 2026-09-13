import * as vscode from 'vscode';
import { resolveInterpreter } from '../python/interpreter';
import { RECOMMENDED_VERSION, classifyVersion } from '../python/versionCheck';
import { ensureSdkReady } from '../sdk/versionGate';

interface WorkerCapabilities {
  veloxquantVersion: string;
  mlxVersion: string | null;
  device: string;
  metalAvailable: boolean;
  supportedOperations: string[];
}

interface WorkerHandle {
  capabilities(): Promise<WorkerCapabilities>;
  metalProbe(): Promise<{ device: string; output: number[]; passed: boolean }>;
  close(): Promise<void>;
}

export async function runDiagnosticsCommand(): Promise<void> {
  if (!(await ensureSdkReady('worker'))) return;
  const resolution = await resolveInterpreter();
  if (!resolution.path) return;

  const output = vscode.window.createOutputChannel('VeloxQuant-MLX Diagnostics');
  output.show(true);
  let worker: WorkerHandle | undefined;
  try {
    const sdk = await import('@veloxquant/sdk');
    if (typeof sdk.startWorker !== 'function') {
      throw new Error('The bundled @veloxquant/sdk does not provide the Metal worker API. Reinstall or update the extension.');
    }
    worker = sdk.startWorker({ interpreterPath: resolution.path, timeoutMs: 30_000 });
    const capabilities = await worker.capabilities();
    if (!capabilities.metalAvailable) {
      throw new Error(`MLX reports that Metal is unavailable on ${capabilities.device}.`);
    }
    const probe = await worker.metalProbe();
    const compatibility = classifyVersion(capabilities.veloxquantVersion, '0.81.0');
    const report = [
      '# VeloxQuant-MLX Diagnostics', '',
      `- Interpreter: \`${resolution.path}\` (${resolution.source})`,
      `- Platform: \`${process.platform}\` / \`${process.arch}\``,
      `- VeloxQuant-MLX: \`${capabilities.veloxquantVersion}\` (${compatibility.replace('-', ' ')})`,
      `- Recommended package: \`${RECOMMENDED_VERSION}\` or newer`,
      `- MLX: \`${capabilities.mlxVersion ?? 'not reported'}\``,
      `- Device: \`${capabilities.device}\``,
      `- Metal available: ${capabilities.metalAvailable ? 'yes' : 'no'}`,
      `- Metal probe: ${probe.passed ? 'passed' : 'failed'} (${probe.output.join(', ')})`,
      `- Worker operations: ${capabilities.supportedOperations.map((operation) => `\`${operation}\``).join(', ')}`,
      '',
    ].join('\n');
    output.appendLine(`[diagnostics] Metal probe ${probe.passed ? 'passed' : 'failed'} on ${probe.device}.`);
    const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (error) {
    output.appendLine(`[diagnostics] failed: ${(error as Error).message}`);
    void vscode.window.showErrorMessage(`VeloxQuant-MLX diagnostics failed: ${(error as Error).message}`);
  } finally {
    await worker?.close().catch(() => {});
  }
}
