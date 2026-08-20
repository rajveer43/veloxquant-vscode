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

/** Builds `KVCacheConfig(method="...", knob=value, ...)` as valid Python source. */
export function buildKVCacheConfigSnippet(method: string, knobs: Record<string, KnobValue>): string {
  const parts = [`method=${pythonRepr(method)}`];
  for (const [key, value] of Object.entries(knobs)) {
    parts.push(`${key}=${pythonRepr(value)}`);
  }
  return `KVCacheConfig(${parts.join(', ')})`;
}

/** Builds the full assignment + builder snippet offered by "Insert into editor". */
export function buildFullSnippet(method: string, knobs: Record<string, KnobValue>): string {
  const configExpr = buildKVCacheConfigSnippet(method, knobs);
  return [
    'from veloxquant_mlx import KVCacheBuilder, KVCacheConfig',
    '',
    `config = ${configExpr}`,
    'caches = KVCacheBuilder.for_model(model, config)',
    '',
  ].join('\n');
}
