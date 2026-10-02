/**
 * Parser for `python -m veloxquant_mlx profile-hardware --json`
 * (veloxquant-mlx >= 0.91.0). Defensive: missing or extra fields are fine,
 * and anything unusable yields `undefined` so callers fall back to sysctl.
 */
import { mapChipGeneration, mapChipName } from './chips';
import type { MappedChip } from './chips';

export const PROFILE_HARDWARE_ARGV = ['-m', 'veloxquant_mlx', 'profile-hardware', '--json'];

export interface HardwareProfile {
  chip: MappedChip | undefined;
  totalMemoryBytes: number | undefined;
  metalAvailable: boolean | undefined;
  peakMemoryBandwidthGbps: number | undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseProfileHardware(stdout: string): HardwareProfile | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;

  const generation = positiveNumber(o.chip_generation);
  const chip =
    (generation !== undefined ? mapChipGeneration(generation) : undefined) ??
    (typeof o.chip === 'string' ? mapChipName(o.chip) : undefined);
  const totalMemoryBytes = positiveNumber(o.total_memory_bytes);
  if (!chip && totalMemoryBytes === undefined) return undefined;

  return {
    chip,
    totalMemoryBytes,
    metalAvailable: typeof o.metal_available === 'boolean' ? o.metal_available : undefined,
    peakMemoryBandwidthGbps: positiveNumber(o.peak_memory_bandwidth_gbps),
  };
}
