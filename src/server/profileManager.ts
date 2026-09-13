import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { resolveInterpreter } from '../python/interpreter';
import { listLocal } from '../sdk/localModels';
import { listServableMethods } from '../sdk/methods';
import { ensureSdkReady } from '../sdk/versionGate';
import { formatBytes } from './format';
import { buildProfileArgv, parseProfilePayload } from './profileProtocol';
import type { ProfilePayload } from './profileProtocol';

class ProfileCancelledError extends Error {
  constructor() {
    super('Profile cancelled.');
    this.name = 'ProfileCancelledError';
  }
}

async function executeProfile(
  interpreterPath: string,
  argv: string[],
  output: vscode.OutputChannel,
  token: vscode.CancellationToken
): Promise<ProfilePayload> {
  return new Promise((resolve, reject) => {
    const child = spawn(interpreterPath, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    const maxJsonBytes = 10 * 1024 * 1024;
    let stdout = '';
    let stdoutBytes = 0;
    let cancelled = false;
    let exceededLimit = false;
    let hardKillTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      hardKillTimer ??= setTimeout(() => child.kill('SIGKILL'), 2_000);
      hardKillTimer.unref();
    };
    const cancellation = token.onCancellationRequested(() => {
      cancelled = true;
      terminate();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (exceededLimit) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxJsonBytes) {
        exceededLimit = true;
        stdout = '';
        terminate();
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => output.append(chunk.toString()));
    child.on('error', (error) => {
      if (hardKillTimer) clearTimeout(hardKillTimer);
      cancellation.dispose();
      reject(error);
    });
    child.on('close', (code) => {
      if (hardKillTimer) clearTimeout(hardKillTimer);
      cancellation.dispose();
      if (cancelled) {
        reject(new ProfileCancelledError());
        return;
      }
      if (exceededLimit) {
        reject(new Error('Profile JSON exceeded the 10 MB safety limit.'));
        return;
      }
      if (code !== 0) {
        reject(new Error(`veloxquant profile exited with code ${code ?? 'unknown'}. See the Profile output channel.`));
        return;
      }
      try {
        resolve(parseProfilePayload(JSON.parse(stdout)));
      } catch (error) {
        reject(new Error(`Could not parse veloxquant profile output: ${(error as Error).message}`));
      }
    });
  });
}

function profileMarkdown(payload: ProfilePayload): string {
  const rows = payload.layers.map((layer) =>
    `| ${layer.layer_index} | ${layer.compute_latency_ms.toFixed(2)} | ${formatBytes(layer.peak_memory_bytes)} | ${layer.compression_ratio.toFixed(2)}x |`
  );
  return [
    '# VeloxQuant-MLX Profile', '',
    `- Model: \`${payload.model}\``,
    `- Method: \`${payload.method}\` (${payload.bits}-bit)`,
    `- Throughput: ${payload.summary.tokens_per_second.toFixed(1)} tokens/sec`,
    `- Total cache compute latency: ${payload.summary.total_latency_ms.toFixed(2)} ms`,
    `- Peak bytes reported: ${formatBytes(payload.summary.peak_memory_bytes)}`,
    `- Mean accounting compression ratio: ${payload.summary.mean_compression_ratio.toFixed(2)}x`,
    '', `> ${payload.accounting_note}`, '',
    '| Layer | Fused compute (ms) | Peak bytes | Accounting ratio |',
    '| ---: | ---: | ---: | ---: |',
    ...rows, '',
  ].join('\n');
}

export async function profileModel(isAnotherModelActive: () => Promise<boolean>): Promise<void> {
  if (!(await ensureSdkReady('profile'))) return;
  if (await isAnotherModelActive()) {
    void vscode.window.showWarningMessage(
      'Stop the active Compression Lab or Chat model before profiling. Profiling loads a separate model and could exhaust unified memory.'
    );
    return;
  }

  let localModels: string[] = [];
  try { localModels = (await listLocal()).map((model) => model.id); } catch { /* free-text fallback below */ }
  const choices = [...localModels, 'Enter a different model id…'];
  const pickedModel = await vscode.window.showQuickPick(choices, { placeHolder: 'Model to profile' });
  if (!pickedModel) return;
  const selectedModel = pickedModel === 'Enter a different model id…'
    ? await vscode.window.showInputBox({ prompt: 'Hugging Face model id or local path', ignoreFocusOut: true })
    : pickedModel;
  const modelId = selectedModel?.trim();
  if (!modelId) return;

  let methods: Awaited<ReturnType<typeof listServableMethods>>;
  try {
    methods = await listServableMethods();
  } catch (error) {
    void vscode.window.showErrorMessage(`VeloxQuant-MLX: could not discover profiling methods: ${(error as Error).message}`);
    return;
  }
  if (methods.length === 0) {
    void vscode.window.showErrorMessage('VeloxQuant-MLX: no serving-compatible methods are available in this Python environment.');
    return;
  }
  const method = await vscode.window.showQuickPick(
    methods.map((item) => ({ label: item.name, description: item.family, detail: item.blurb })),
    { placeHolder: 'Servable compression method' }
  );
  if (!method) return;
  const bitsChoice = await vscode.window.showQuickPick(['2', '1', '4'], { placeHolder: 'KV-cache bit width' });
  if (!bitsChoice) return;
  const prompt = await vscode.window.showInputBox({
    prompt: 'Prompt used for the profiling run', value: 'The quick brown fox jumps over the lazy dog.', ignoreFocusOut: true,
  });
  if (prompt === undefined) return;
  const maxTokensRaw = await vscode.window.showInputBox({
    prompt: 'Maximum generated tokens', value: '64', validateInput: (value) => /^[1-9]\d*$/.test(value) ? undefined : 'Enter a positive integer.',
  });
  if (!maxTokensRaw) return;

  const resolution = await resolveInterpreter();
  if (!resolution.path) return;
  const output = vscode.window.createOutputChannel('VeloxQuant-MLX Profile');
  output.show(true);
  const argv = buildProfileArgv({
    model: modelId, method: method.label, bits: Number(bitsChoice), prompt, maxTokens: Number(maxTokensRaw),
  });

  try {
    const payload = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Profiling ${modelId} with ${method.label}`, cancellable: true },
      (_progress, token) => executeProfile(resolution.path!, argv, output, token)
    );
    const doc = await vscode.workspace.openTextDocument({ content: profileMarkdown(payload), language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (error) {
    if (error instanceof ProfileCancelledError) {
      output.appendLine('[profile] cancelled.');
      return;
    }
    output.appendLine(`[profile] failed: ${(error as Error).message}`);
    void vscode.window.showErrorMessage(`VeloxQuant-MLX profile failed: ${(error as Error).message}`);
  }
}
