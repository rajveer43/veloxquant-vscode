/**
 * Builds a valid Python `KVCacheConfig(...)` snippet from a recommended
 * method name and its knobs. Pure function, no VS Code dependency, so it is
 * cheap to unit test directly.
 */

export type KnobValue = string | number | boolean;

/** Python repr for a single knob value: quoted strings, bare numbers/bools. */
export function pythonRepr(value: KnobValue): string {
  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot represent non-finite number in Python source: ${value}`);
    }
    return String(value);
  }
  // String: use Python's single-quote repr, escaping backslashes and quotes.
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

interface ChangedDefault {
  knob: string;
  value: KnobValue;
  note: string;
}

/**
 * Knobs whose library default changed, per method. Emitting them explicitly
 * keeps an inserted snippet behaving the same after the library is upgraded.
 */
const CHANGED_DEFAULTS: Record<string, ChangedDefault[]> = {
  xquant: [{ knob: 'xquant_residual_bits', value: 4, note: 'default was 0 before veloxquant-mlx 0.94 (0 degraded generation)' }],
  turboquant_prod: [{ knob: 'enable_vectorized_attend', value: true, note: 'now True by default (was False)' }],
  turboquant_mse: [{ knob: 'enable_vectorized_attend', value: true, note: 'now True by default (was False)' }],
};

/** Changed-default knobs for `method` that the caller did not already set. */
export function explicitDefaultsFor(method: string, knobs: Record<string, KnobValue>): ChangedDefault[] {
  return (CHANGED_DEFAULTS[method] ?? []).filter((d) => !(d.knob in knobs));
}

/** Builds `KVCacheConfig(method="...", knob=value, ...)` as valid Python source. */
export function buildKVCacheConfigSnippet(method: string, knobs: Record<string, KnobValue>): string {
  const parts = [`method=${pythonRepr(method)}`];
  for (const [key, value] of Object.entries(knobs)) {
    parts.push(`${key}=${pythonRepr(value)}`);
  }
  for (const d of explicitDefaultsFor(method, knobs)) {
    parts.push(`${d.knob}=${pythonRepr(d.value)}`);
  }
  return `KVCacheConfig(${parts.join(', ')})`;
}

/** Builds the full assignment + builder snippet offered by "Insert into editor". */
export function buildFullSnippet(method: string, knobs: Record<string, KnobValue>): string {
  const configExpr = buildKVCacheConfigSnippet(method, knobs);
  const notes = explicitDefaultsFor(method, knobs).map((d) => `# ${d.knob} set explicitly: ${d.note}`);
  return [
    'from veloxquant_mlx import KVCacheBuilder, KVCacheConfig',
    '',
    ...notes,
    `config = ${configExpr}`,
    'caches = KVCacheBuilder.for_model(model, config)',
    '',
  ].join('\n');
}
