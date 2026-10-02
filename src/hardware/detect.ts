/**
 * Best-effort detection of Apple Silicon chip generation and installed RAM,
 * used only to prefill the Recommend form. Never blocks the form: any
 * failure or non-Darwin platform resolves to an empty result.
 */
import { execFile } from 'node:child_process';
import { mapChipName } from './chips';
import type { RecommendChip } from './chips';
import { parseProfileHardware } from './profileHardware';

export type DetectedChip = RecommendChip;

export interface DetectedHardware {
  chip: DetectedChip | undefined;
  /** Visible note when the detected chip was mapped to the nearest one the recommender accepts. */
  chipNote?: string;
  ramGb: 8 | 16 | 24 | 32 | 36 | 48 | 64 | 96 | 128 | 192 | 512 | undefined;
}

const RAM_STEPS: DetectedHardware['ramGb'][] = [8, 16, 24, 32, 36, 48, 64, 96, 128, 192, 512];

function nearestRamStep(bytes: number): DetectedHardware['ramGb'] {
  const gb = bytes / 1024 / 1024 / 1024;
  let closest = RAM_STEPS[0] as number;
  let bestDiff = Infinity;
  for (const step of RAM_STEPS) {
    const diff = Math.abs((step as number) - gb);
    if (diff < bestDiff) {
      bestDiff = diff;
      closest = step as number;
    }
  }
  return closest as DetectedHardware['ramGb'];
}

function defaultSysctl(key: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('sysctl', ['-n', key], { timeout: 2000 }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * `sysctl` and `profile` are injectable so tests can simulate hardware without
 * shelling out. `profile` returns the stdout of `veloxquant profile-hardware
 * --json` (or undefined when unavailable, e.g. package < 0.91.0); it is
 * preferred when it yields usable data, and sysctl is the fallback.
 */
export async function detectHardware(
  sysctl: (key: string) => Promise<string | undefined> = defaultSysctl,
  profile?: () => Promise<string | undefined>
): Promise<DetectedHardware> {
  if (process.platform !== 'darwin') {
    return { chip: undefined, ramGb: undefined };
  }

  if (profile) {
    try {
      const stdout = await profile();
      const parsed = stdout ? parseProfileHardware(stdout) : undefined;
      if (parsed && (parsed.chip || parsed.totalMemoryBytes !== undefined)) {
        return {
          chip: parsed.chip?.chip,
          chipNote: parsed.chip?.note,
          ramGb: parsed.totalMemoryBytes !== undefined ? nearestRamStep(parsed.totalMemoryBytes) : undefined,
        };
      }
    } catch {
      // fall through to sysctl
    }
  }

  try {
    const [brand, memsize] = await Promise.all([sysctl('machdep.cpu.brand_string'), sysctl('hw.memsize')]);

    const mapped = brand && /Apple/.test(brand) ? mapChipName(brand) : undefined;

    let ramGb: DetectedHardware['ramGb'];
    if (memsize) {
      const bytes = Number(memsize);
      if (Number.isFinite(bytes) && bytes > 0) {
        ramGb = nearestRamStep(bytes);
      }
    }

    return { chip: mapped?.chip, chipNote: mapped?.note, ramGb };
  } catch {
    return { chip: undefined, ramGb: undefined };
  }
}
