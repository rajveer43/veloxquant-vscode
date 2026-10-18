/**
 * Reads the allowed Recommend form values (chips, RAM sizes, model classes,
 * goals) from `python -m veloxquant_mlx recommend --dump-ruleset`
 * (`ruleset_dict()` in veloxquant_mlx/tools/mac_recommender.py, schema
 * `version: 1`), so a value the library adds shows up without an extension
 * release. Falls back to the built-in lists when the command is unavailable.
 */
import { execFile } from 'node:child_process';
import { KNOWN_CHIPS } from '../hardware/chips';

export interface Ruleset {
  chips: string[];
  ramGb: number[];
  modelClasses: string[];
  goals: string[];
}

export const FALLBACK_RULESET: Ruleset = {
  chips: [...KNOWN_CHIPS],
  ramGb: [8, 16, 24, 32, 36, 48, 64, 96, 128, 192, 512],
  modelClasses: ['1B', '3B', '7B', '14B', '32B', '70B', '120B', '235B', '671B'],
  goals: ['everyday', 'max_key_accounting', 'max_context', 'best_quality', 'constant_memory'],
};

const RULESET_ARGV = ['-m', 'veloxquant_mlx', 'recommend', '--dump-ruleset'];

function nonEmpty<T>(value: unknown, guard: (item: unknown) => item is T): T[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(guard) ? value : undefined;
}
const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isPositiveNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Parses `--dump-ruleset` stdout; undefined when it is not the expected shape. Each list falls back individually. */
export function parseRuleset(stdout: string): Ruleset | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const chips = nonEmpty(o.chips, isString);
  const ramGb = nonEmpty(o.allowed_ram_gb, isPositiveNumber);
  const modelClasses = nonEmpty(o.model_classes, isString);
  const goals = nonEmpty(o.goals, isString);
  if (!chips && !ramGb && !modelClasses && !goals) return undefined;
  return {
    chips: chips ?? FALLBACK_RULESET.chips,
    ramGb: ramGb ?? FALLBACK_RULESET.ramGb,
    modelClasses: modelClasses ?? FALLBACK_RULESET.modelClasses,
    goals: goals ?? FALLBACK_RULESET.goals,
  };
}

const cache = new Map<string, Ruleset>();

/**
 * Ruleset for the interpreter's installed package, cached per interpreter +
 * version. `version` undefined (not installed / unreadable) returns the fallback uncached.
 */
export async function getRuleset(interpreterPath: string, version: string | undefined): Promise<Ruleset> {
  if (!version) return FALLBACK_RULESET;
  const key = `${interpreterPath}\0${version}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const stdout = await new Promise<string | undefined>((resolve) => {
    execFile(interpreterPath, RULESET_ARGV, { timeout: 10000 }, (err, out) => resolve(err ? undefined : out));
  });
  const parsed = stdout ? parseRuleset(stdout) : undefined;
  if (!parsed) return FALLBACK_RULESET;
  cache.set(key, parsed);
  return parsed;
}
