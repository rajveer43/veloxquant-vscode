/**
 * `recommend --json` and the panel server's version-tagged /api/status are
 * both 0.42.0+ features. This module tracks the version once observed and
 * flags installs that predate the minimum, which need a distinct message
 * from "not installed at all".
 */
export const MIN_SUPPORTED_VERSION = '0.42.0';
export const MIN_RECOMMEND_VERSION = '0.42.0';
export const MIN_PANEL_VERSION = '0.46.0';
export const MIN_PROFILE_VERSION = '0.68.0';
export const MIN_WORKER_VERSION = '0.81.0';
export const RECOMMENDED_VERSION = '0.83.0';

export type PackageFeature = 'recommend' | 'panel' | 'serve' | 'profile' | 'worker';

export const FEATURE_MINIMUMS: Record<PackageFeature, string> = {
  recommend: MIN_RECOMMEND_VERSION,
  panel: MIN_PANEL_VERSION,
  serve: MIN_PANEL_VERSION,
  profile: MIN_PROFILE_VERSION,
  worker: MIN_WORKER_VERSION,
};

export function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseComparableVersion(version: string): { parts: [number, number, number]; prerelease: boolean } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!match) return undefined;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: Boolean(match[4]),
  };
}

/** Returns true if `version` is >= MIN_SUPPORTED_VERSION. Unparsable versions are treated as supported (fail open, since the real error will surface elsewhere). */
export function isVersionSupported(version: string, minimum: string = MIN_SUPPORTED_VERSION): boolean {
  const parsedVersion = parseComparableVersion(version);
  const parsedMinimum = parseComparableVersion(minimum);
  const v = parsedVersion?.parts;
  const min = parsedMinimum?.parts;
  if (!v || !min) {
    return true;
  }
  for (let i = 0; i < 3; i++) {
    if (v[i] > min[i]) return true;
    if (v[i] < min[i]) return false;
  }
  if (parsedVersion?.prerelease && !parsedMinimum?.prerelease) return false;
  return true;
}

export type VersionCompatibility = 'unsupported' | 'supported' | 'upgrade-recommended' | 'unverifiable';

export function classifyVersion(
  version: string,
  minimum: string,
  recommended: string = RECOMMENDED_VERSION
): VersionCompatibility {
  if (!parseVersion(version)) return 'unverifiable';
  if (!isVersionSupported(version, minimum)) return 'unsupported';
  if (!isVersionSupported(version, recommended)) return 'upgrade-recommended';
  return 'supported';
}

/** Reads `veloxquant_mlx.__version__` via a fast interpreter call. */
export async function getInstalledVersion(
  interpreterPath: string,
  execFileAsync: (file: string, args: string[]) => Promise<{ stdout: string; code: number }>
): Promise<string | undefined> {
  try {
    const { stdout, code } = await execFileAsync(interpreterPath, [
      '-c',
      'import veloxquant_mlx; print(veloxquant_mlx.__version__)',
    ]);
    if (code !== 0) {
      return undefined;
    }
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
