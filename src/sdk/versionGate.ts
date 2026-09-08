/**
 * Lazy, first-use check that the resolved interpreter's installed
 * VeloxQuant-MLX package satisfies the minimum version the SDK-backed
 * features need. Matches the existing pattern in `versionCheck.ts`'s own
 * usage site (checked on first real use, not eagerly at `activate()`) and
 * reuses its version-comparison logic rather than duplicating it.
 */
import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { getInstalledVersion, isVersionSupported, MIN_SUPPORTED_VERSION } from '../python/versionCheck';
import { resolveInterpreter, promptSelectInterpreter } from '../python/interpreter';

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (err, stdout) => {
      if (err && typeof (err as NodeJS.ErrnoException).code === 'string') {
        reject(err);
        return;
      }
      resolve({ stdout, code: err ? ((err as { code?: number }).code ?? 1) : 0 });
    });
  });
}

/**
 * Resolves an interpreter and verifies its installed package version,
 * surfacing an actionable message and returning `false` if either step
 * fails. Callers should bail out of the SDK-backed action (not proceed and
 * let the SDK fail with a less clear error) when this returns `false`.
 */
export async function ensureSdkReady(): Promise<boolean> {
  const resolution = await resolveInterpreter();
  if (!resolution.path) {
    const choice = await vscode.window.showWarningMessage(
      'VeloxQuant-MLX: no Python interpreter resolved. Select one to continue.',
      'Select Interpreter'
    );
    if (choice === 'Select Interpreter') {
      await promptSelectInterpreter();
    }
    return false;
  }

  const version = await getInstalledVersion(resolution.path, execFileAsync);
  if (!version) {
    void vscode.window.showWarningMessage(
      `VeloxQuant-MLX is not installed in the resolved interpreter (${resolution.path}).`
    );
    return false;
  }

  if (!isVersionSupported(version)) {
    void vscode.window.showWarningMessage(
      `VeloxQuant-MLX ${version} is installed, but this feature needs ${MIN_SUPPORTED_VERSION}+. Upgrade the package to continue.`
    );
    return false;
  }

  return true;
}
