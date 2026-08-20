/**
 * Best-effort detection of Apple Silicon chip generation and installed RAM,
 * used only to prefill the Recommend form. Never blocks the form: any
 * failure or non-Darwin platform resolves to an empty result.
 */
import { execFile } from 'node:child_process';

export interface DetectedHardware {
  chip: 'M1' | 'M2' | 'M3' | 'M4' | undefined;
  ramGb: 8 | 16 | 24 | 32 | 36 | 48 | 64 | 128 | undefined;
}

const RAM_STEPS: DetectedHardware['ramGb'][] = [8, 16, 24, 32, 36, 48, 64, 128];

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

function sysctl(key: string): Promise<string | undefined> {
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

export async function detectHardware(): Promise<DetectedHardware> {
  if (process.platform !== 'darwin') {
    return { chip: undefined, ramGb: undefined };
  }

  try {
    const [brand, memsize] = await Promise.all([sysctl('machdep.cpu.brand_string'), sysctl('hw.memsize')]);

    let chip: DetectedHardware['chip'];
    if (brand) {
      const match = /Apple (M[1-4])/.exec(brand);
      if (match) {
        chip = match[1] as DetectedHardware['chip'];
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
