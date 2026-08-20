/**
 * `recommend --json` and the panel server's version-tagged /api/status are
 * both 0.42.0+ features. This module tracks the version once observed and
 * flags installs that predate the minimum, which need a distinct message
 * from "not installed at all".
 */
export const MIN_SUPPORTED_VERSION = '0.42.0';

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Returns true if `version` is >= MIN_SUPPORTED_VERSION. Unparsable versions are treated as supported (fail open, since the real error will surface elsewhere). */
export function isVersionSupported(version: string, minimum: string = MIN_SUPPORTED_VERSION): boolean {
  const v = parseVersion(version);
  const min = parseVersion(minimum);
  if (!v || !min) {
    return true;
  }
  for (let i = 0; i < 3; i++) {
    if (v[i] > min[i]) return true;
    if (v[i] < min[i]) return false;
  }
  return true;
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
