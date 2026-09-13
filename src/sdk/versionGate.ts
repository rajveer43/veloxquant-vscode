/**
 * Lazy, first-use check that the resolved interpreter's installed
 * VeloxQuant-MLX package satisfies the minimum version the SDK-backed
 * features need. Matches the existing pattern in `versionCheck.ts`'s own
 * usage site (checked on first real use, not eagerly at `activate()`) and
 * reuses its version-comparison logic rather than duplicating it.
 */
import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import {
  classifyVersion,
  FEATURE_MINIMUMS,
  getInstalledVersion,
  RECOMMENDED_VERSION,
} from '../python/versionCheck';
import type { PackageFeature } from '../python/versionCheck';
import { buildPipInstallCommand, resolveInterpreter, promptSelectInterpreter } from '../python/interpreter';

const recommendedNotices = new Set<string>();

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
async function offerUpgrade(interpreterPath: string, message: string): Promise<void> {
  const choice = await vscode.window.showWarningMessage(message, 'Upgrade VeloxQuant-MLX');
  if (choice !== 'Upgrade VeloxQuant-MLX') return;
  const terminal = vscode.window.createTerminal('Upgrade VeloxQuant-MLX');
  terminal.show();
  terminal.sendText(buildPipInstallCommand(interpreterPath, true));
}

export async function ensureSdkReady(feature: PackageFeature = 'recommend'): Promise<boolean> {
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

  const minimum = FEATURE_MINIMUMS[feature];
  const compatibility = classifyVersion(version, minimum);
  if (compatibility === 'unsupported') {
    await offerUpgrade(
      resolution.path,
      `VeloxQuant-MLX ${version} is installed, but ${feature} needs ${minimum} or newer.`
    );
    return false;
  }

  if (compatibility === 'unverifiable') {
    void vscode.window.showWarningMessage(
      `VeloxQuant-MLX reported version "${version}". The extension could not verify the ${minimum}+ requirement; the ${feature} command will continue and surface any backend error.`
    );
  }

  if (compatibility === 'upgrade-recommended' && !recommendedNotices.has(version)) {
    recommendedNotices.add(version);
    const choice = await vscode.window.showInformationMessage(
      `VeloxQuant-MLX ${version} supports ${feature}; ${RECOMMENDED_VERSION} or newer is recommended for current cache and schema fixes.`,
      'Upgrade VeloxQuant-MLX'
    );
    if (choice === 'Upgrade VeloxQuant-MLX') {
      const terminal = vscode.window.createTerminal('Upgrade VeloxQuant-MLX');
      terminal.show();
      terminal.sendText(buildPipInstallCommand(resolution.path, true));
    }
  }

  return true;
}
