/**
 * Shared chip mapping for hardware detection. `recommend --chip` only accepts
 * M1–M4 (veloxquant-mlx 0.92.2); a newer chip is mapped to the nearest known
 * one so the form never offers a value the CLI rejects.
 */
export type RecommendChip = 'M1' | 'M2' | 'M3' | 'M4';

export const KNOWN_CHIPS: readonly RecommendChip[] = ['M1', 'M2', 'M3', 'M4'];

export interface MappedChip {
  chip: RecommendChip;
  /** Set when the detected chip is not one the recommender knows. */
  note?: string;
}

/** Maps a generation number (e.g. 4 from "M4 Pro") to a recommender chip. */
export function mapChipGeneration(generation: number): MappedChip | undefined {
  if (!Number.isInteger(generation) || generation < 1) return undefined;
  if (generation <= 4) return { chip: `M${generation}` as RecommendChip };
  return {
    chip: 'M4',
    note: `Detected Apple M${generation}, which the recommender doesn't list yet — using M4 as the nearest match.`,
  };
}

/** Maps a chip name ("Apple M4 Pro", "M2") to a recommender chip. */
export function mapChipName(name: string): MappedChip | undefined {
  const match = /\bM(\d+)\b/.exec(name);
  return match ? mapChipGeneration(Number(match[1])) : undefined;
}
