/**
 * Best-effort detection of Apple Silicon chip generation and installed RAM,
 * used only to prefill the Recommend form. Never blocks the form: any
 * failure or non-Darwin platform resolves to an empty result.
 */
import { execFile } from 'node:child_process';

export type DetectedChip = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';

const KNOWN_CHIPS: readonly DetectedChip[] = ['M1', 'M2', 'M3', 'M4', 'M5'];

export interface DetectedHardware {
  chip: DetectedChip | undefined;
  ramGb: 8 | 16 | 24 | 32 | 36 | 48 | 64 | 96 | 128 | 192 | 256 | 512 | undefined;
}

const RAM_STEPS: DetectedHardware['ramGb'][] = [8, 16, 24, 32, 36, 48, 64, 96, 128, 192, 256, 512];

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

/** `sysctl` is injectable so tests can simulate hardware without shelling out. */
export async function detectHardware(
  sysctl: (key: string) => Promise<string | undefined> = defaultSysctl
): Promise<DetectedHardware> {
  if (process.platform !== 'darwin') {
    return { chip: undefined, ramGb: undefined };
  }

  try {
    const [brand, memsize] = await Promise.all([sysctl('machdep.cpu.brand_string'), sysctl('hw.memsize')]);

    let chip: DetectedHardware['chip'];
    if (brand) {
      const match = /Apple (M\d+)/.exec(brand);
      const candidate = match?.[1];
      if (candidate && (KNOWN_CHIPS as readonly string[]).includes(candidate)) {
        chip = candidate as DetectedChip;
      }
    }

    let ramGb: DetectedHardware['ramGb'];
    if (memsize) {
      const bytes = Number(memsize);
      if (Number.isFinite(bytes) && bytes > 0) {
        ramGb = nearestRamStep(bytes);
      }
    }

    return { chip, ramGb };
  } catch {
    return { chip: undefined, ramGb: undefined };
  }
}
