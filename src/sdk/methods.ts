import type { MethodInfo } from '@veloxquant/sdk' with { 'resolution-mode': 'require' };
import type { CliMethodInfo } from '../python/methodsClient';
import { getVeloxQuantOptions } from './client';

/**
 * A servable method. `maturity` and `fieldSchema` are present when discovered
 * through `methods --json` (veloxquant-mlx >= MIN_METHOD_METADATA_VERSION) and
 * absent on the SDK fallback, whose `MethodInfo` omits them.
 */
export type ServableMethod = Pick<MethodInfo, 'name' | 'family' | 'blurb' | 'isServable'> &
  Partial<Pick<CliMethodInfo, 'maturity' | 'configFields' | 'fieldSchema' | 'coverage' | 'paperDeviation'>>;

export interface MethodDiscoveryDeps {
  interpreterPath: () => Promise<string | undefined>;
  installedVersion: (interpreterPath: string) => Promise<string | undefined>;
  cli: (interpreterPath: string) => Promise<CliMethodInfo[]>;
  sdk: () => Promise<MethodInfo[]>;
}

/** CLI-backed discovery on installs that carry method metadata; the SDK otherwise (or if the CLI call fails). */
export async function discoverServableMethods(deps: MethodDiscoveryDeps, minVersion: string, isSupported: (v: string, min: string) => boolean): Promise<ServableMethod[]> {
  const interpreter = await deps.interpreterPath();
  const version = interpreter ? await deps.installedVersion(interpreter) : undefined;
  if (interpreter && version && isSupported(version, minVersion)) {
    try {
      return (await deps.cli(interpreter)).filter((method) => method.isServable);
    } catch {
      // fall through to the SDK
    }
  }
  return (await deps.sdk()).filter((method) => method.isServable);
}

export async function listServableMethods(): Promise<ServableMethod[]> {
  const { MIN_METHOD_METADATA_VERSION, getInstalledVersion, isVersionSupported } = await import('../python/versionCheck.js');
  const { getMethods } = await import('../python/methodsClient.js');
  const { execFile } = await import('node:child_process');
  return discoverServableMethods(
    {
      interpreterPath: async () => (await getVeloxQuantOptions()).pythonPath,
      installedVersion: (path) =>
        getInstalledVersion(path, (file, args) =>
          new Promise((resolve, reject) =>
            execFile(file, args, (err, stdout) => {
              if (err && typeof (err as NodeJS.ErrnoException).code === 'string') reject(err);
              else resolve({ stdout, code: err ? ((err as { code?: number }).code ?? 1) : 0 });
            })
          )
        ),
      cli: async (path) => (await getMethods(path, { servableOnly: true })).methods,
      sdk: async () => {
        const { listMethods } = await import('@veloxquant/sdk');
        return (await listMethods({ servableOnly: true }, await getVeloxQuantOptions())).methods;
      },
    },
    MIN_METHOD_METADATA_VERSION,
    isVersionSupported
  );
}

const MATURITY_ORDER = ['stable', 'beta', 'experimental'];

/**
 * Orders methods stable-first and, unless `showExperimental`, drops the
 * experimental ones. Methods without `maturity` (SDK fallback on older
 * installs) are never hidden and rank with stable, keeping their original order.
 */
export function arrangeForPicker<T extends Pick<ServableMethod, 'maturity'>>(methods: T[], showExperimental: boolean): T[] {
  const visible = showExperimental ? methods : methods.filter((method) => method.maturity !== 'experimental');
  const rank = (method: T) => (method.maturity ? MATURITY_ORDER.indexOf(method.maturity) : 0);
  return visible
    .map((method, index) => ({ method, index }))
    .sort((a, b) => rank(a.method) - rank(b.method) || a.index - b.index)
    .map(({ method }) => method);
}

/** Badge text for picker rows; undefined when the library did not report maturity. */
export function maturityBadge(method: Pick<ServableMethod, 'maturity'>): string | undefined {
  return method.maturity;
}
