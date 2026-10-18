/**
 * Pure helpers for editing a recommended method's knobs from its
 * `field_schema` (`methods --json`). No `vscode` dependency.
 */
import type { KnobValue } from './snippetBuilder';

/** Field types the editor can offer an input for; `array` and `unknown` stay read-only. */
export const EDITABLE_TYPES: readonly string[] = ['int', 'float', 'bool', 'str'];

export interface EditableField {
  name: string;
  type: string;
  default: unknown;
  help: string | null;
}

/** Parses an input string by schema type; undefined when empty or invalid (the field is then left unchanged). */
export function parseKnobInput(type: string, raw: string): KnobValue | undefined {
  const text = raw.trim();
  if (type === 'bool') return text === 'true' ? true : text === 'false' ? false : undefined;
  if (text === '') return undefined;
  if (type === 'int') return /^-?\d+$/.test(text) ? Number(text) : undefined;
  if (type === 'float') {
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  }
  return type === 'str' ? text : undefined;
}

/**
 * Merges edits over the recommended knobs. An edit is kept when the knob was
 * already part of the recommendation or differs from the schema default, so
 * untouched defaults never bloat the snippet.
 */
export function mergeKnobEdits(
  recommended: Record<string, KnobValue>,
  edits: Record<string, KnobValue>,
  fields: readonly EditableField[]
): Record<string, KnobValue> {
  const merged: Record<string, KnobValue> = { ...recommended };
  for (const [name, value] of Object.entries(edits)) {
    const field = fields.find((f) => f.name === name);
    if (name in recommended || !field || field.default !== value) merged[name] = value;
  }
  return merged;
}

/** Fields `veloxquant profile` already takes through dedicated flags, so `--set` must not repeat them. */
const PROFILE_FLAG_FIELDS = new Set(['bit_width_inlier', 'seed']);

/** `--set FIELD=VALUE` argv for every knob `profile` has no dedicated flag for (bool → true/false). */
export function profileSetArgs(knobs: Record<string, KnobValue>): string[] {
  const args: string[] = [];
  for (const [name, value] of Object.entries(knobs)) {
    if (PROFILE_FLAG_FIELDS.has(name)) continue;
    args.push('--set', `${name}=${typeof value === 'boolean' ? (value ? 'true' : 'false') : value}`);
  }
  return args;
}
