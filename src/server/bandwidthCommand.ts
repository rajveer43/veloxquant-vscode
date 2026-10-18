import * as vscode from 'vscode';
import { resolveInterpreter } from '../python/interpreter';
import { FEATURE_MINIMUMS, getInstalledVersion, isVersionSupported } from '../python/versionCheck';
import { execFile } from 'node:child_process';
import { formatBandwidth, measureBandwidth } from '../hardware/measureBandwidth';
import type { BandwidthMeasurement } from '../hardware/measureBandwidth';

/** Measures bandwidth with a progress notification; undefined if unsupported or failed. */
export async function measureBandwidthWithProgress(interpreterPath: string): Promise<BandwidthMeasurement | undefined> {
  const version = await getInstalledVersion(interpreterPath, (file, args) =>
    new Promise((resolve, reject) =>
      execFile(file, args, (err, stdout) => {
        if (err && typeof (err as NodeJS.ErrnoException).code === 'string') reject(err);
        else resolve({ stdout, code: err ? ((err as { code?: number }).code ?? 1) : 0 });
      })
    )
  );
  if (version && !isVersionSupported(version, FEATURE_MINIMUMS['profile-hardware'])) return undefined;
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'VeloxQuant-MLX: measuring memory bandwidth…' },
    () => measureBandwidth(interpreterPath)
  );
}

export async function measureBandwidthCommand(): Promise<void> {
  const resolution = await resolveInterpreter();
  if (!resolution.path) return;
  const result = await measureBandwidthWithProgress(resolution.path);
  if (result) {
    void vscode.window.showInformationMessage(`VeloxQuant-MLX: measured memory bandwidth ${formatBandwidth(result)}.`);
  } else {
    void vscode.window.showWarningMessage(
      `VeloxQuant-MLX: could not measure bandwidth. It needs a package with 'profile-hardware --measure-bandwidth' (${FEATURE_MINIMUMS['profile-hardware']}+) on Apple Silicon.`
    );
  }
}
