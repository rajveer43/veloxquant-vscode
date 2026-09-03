/**
 * "VeloxQuant-MLX: Profile Active Session" command support. Calls the
 * control-plane server's `/api/profile` route (mirrors `/api/memory`) and
 * prints the per-layer quantize/dequantize/write latency, peak memory,
 * compression ratio, and tokens/sec breakdown to a dedicated Output Channel.
 *
 * Only meaningful while a Compression Lab-started inference server is
 * running, so it's gated the same way as the status bar item and Stop
 * Inference Server command.
 */
import * as vscode from 'vscode';
import { PanelServerManager } from './panelServerManager';
import { formatBytes } from './format';

function formatMs(ms: number | null): string {
  return ms == null ? '-' : `${ms.toFixed(2)} ms`;
}

export async function profileActiveSession(getManager: () => PanelServerManager | undefined): Promise<void> {
  const manager = getManager();
  if (!manager) {
    void vscode.window.showInformationMessage(
      'VeloxQuant-MLX: open the Compression Lab first to start a session before profiling.'
    );
    return;
  }

  const state = await manager.classifyInferenceServerState();
  if (state === 'error') {
    void vscode.window.showErrorMessage(
      'VeloxQuant-MLX: the inference server is in an error state and cannot be profiled.'
    );
    return;
  }
  if (state !== 'running') {
    void vscode.window.showInformationMessage('VeloxQuant-MLX: no inference server is running to profile.');
    return;
  }

  const outputChannel = vscode.window.createOutputChannel('VeloxQuant-MLX Profile');

  try {
    const profile = await manager.client.getProfile();
    outputChannel.clear();
    outputChannel.appendLine(`VeloxQuant-MLX profile — method: ${profile.method}`);
    outputChannel.appendLine('');

    if (profile.table) {
      outputChannel.appendLine(profile.table);
    } else {
      outputChannel.appendLine('layer  quantize   dequantize  write      peak_mem   ratio   tok/s');
      for (const row of profile.layers) {
        outputChannel.appendLine(
          [
            String(row.layer).padEnd(6),
            formatMs(row.quantize_ms).padEnd(11),
            formatMs(row.dequantize_ms).padEnd(12),
            formatMs(row.write_ms).padEnd(11),
            formatBytes(row.peak_memory_bytes).padEnd(11),
            (row.compression_ratio != null ? row.compression_ratio.toFixed(2) : '-').padEnd(8),
            row.tokens_per_sec != null ? row.tokens_per_sec.toFixed(1) : '-',
          ].join('')
        );
      }
    }

    outputChannel.show(true);
  } catch (err) {
    outputChannel.appendLine(`Failed to fetch profile: ${(err as Error).message}`);
    outputChannel.show(true);
    void vscode.window.showErrorMessage(`VeloxQuant-MLX: could not fetch the profile (${(err as Error).message}).`);
  }
}
