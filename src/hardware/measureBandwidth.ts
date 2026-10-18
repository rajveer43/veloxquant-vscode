/**
 * Runs `profile-hardware --json --measure-bandwidth` (veloxquant-mlx >= 0.91.0)
 * and returns the measured copy bandwidth in GB/s. No VS Code dependency.
 */
import { execFile } from 'node:child_process';
import { MEASURE_BANDWIDTH_ARGV, parseProfileHardware } from './profileHardware';

export interface BandwidthMeasurement {
  measuredGbps: number;
  /** Nominal chip peak reported alongside, when known. */
  nominalGbps?: number;
}

/** Pulls the measurement out of `profile-hardware --json --measure-bandwidth` stdout; undefined when absent. */
export function parseBandwidthMeasurement(stdout: string): BandwidthMeasurement | undefined {
  const profile = parseProfileHardware(stdout);
  if (profile?.measuredBandwidthGbps === undefined) return undefined;
  return { measuredGbps: profile.measuredBandwidthGbps, nominalGbps: profile.peakMemoryBandwidthGbps };
}

export function measureBandwidth(interpreterPath: string, timeoutMs = 60000): Promise<BandwidthMeasurement | undefined> {
  return new Promise((resolve) => {
    execFile(interpreterPath, MEASURE_BANDWIDTH_ARGV, { timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? undefined : parseBandwidthMeasurement(stdout));
    });
  });
}

export function formatBandwidth(m: BandwidthMeasurement): string {
  const nominal = m.nominalGbps !== undefined ? ` (nominal peak ${m.nominalGbps.toFixed(0)} GB/s)` : '';
  return `${m.measuredGbps.toFixed(1)} GB/s${nominal}`;
}
