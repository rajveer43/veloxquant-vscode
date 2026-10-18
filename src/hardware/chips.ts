/**
 * Shared chip mapping for hardware detection. `recommend --chip` only accepts
 * the chips the installed library lists (read from `recommend --dump-ruleset`,
 * see python/rulesetClient.ts; M1–M4 as of veloxquant-mlx 0.94.x). A chip the
 * library lacks is mapped to the nearest known one so the form never offers a
 * value the CLI rejects.
 */
export type RecommendChip = string;

/** Fallback used when the installed library's ruleset cannot be read. */
export const KNOWN_CHIPS: readonly RecommendChip[] = ['M1', 'M2', 'M3', 'M4'];

export interface MappedChip {
  chip: RecommendChip;
  /** Set when the detected chip is not one the recommender knows. */
  note?: string;
}

function generationOf(chip: string): number | undefined {
  const match = /^M(\d+)$/.exec(chip);
  return match ? Number(match[1]) : undefined;
}

/** Maps a generation number (e.g. 4 from "M4 Pro") to a recommender chip. */
export function mapChipGeneration(generation: number, known: readonly RecommendChip[] = KNOWN_CHIPS): MappedChip | undefined {
  if (!Number.isInteger(generation) || generation < 1) return undefined;
  const exact = `M${generation}`;
  if (known.includes(exact)) return { chip: exact };
  // Nearest known chip: the newest one at or below the detected generation, else the oldest above it.
  const generations = known
    .map((chip) => ({ chip, gen: generationOf(chip) }))
    .filter((c): c is { chip: string; gen: number } => c.gen !== undefined)
    .sort((a, b) => a.gen - b.gen);
  if (generations.length === 0) return undefined;
  const below = generations.filter((c) => c.gen < generation);
  const nearest = below.length > 0 ? below[below.length - 1] : generations[0];
  return {
    chip: nearest.chip,
    note: `Detected Apple M${generation}, which the recommender doesn't list yet — using ${nearest.chip} as the nearest match.`,
  };
}

/** Maps a chip name ("Apple M4 Pro", "M2") to a recommender chip. */
export function mapChipName(name: string, known: readonly RecommendChip[] = KNOWN_CHIPS): MappedChip | undefined {
  const match = /\bM(\d+)\b/.exec(name);
  return match ? mapChipGeneration(Number(match[1]), known) : undefined;
}
