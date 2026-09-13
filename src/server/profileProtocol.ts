export interface ProfileLayer {
  layer_index: number;
  compute_latency_ms: number;
  is_fused: boolean;
  peak_memory_bytes: number;
  compression_ratio: number;
}

export interface ProfilePayload {
  schema_version: 1;
  model: string;
  method: string;
  bits: number;
  accounting_only: true;
  accounting_note: string;
  layers: ProfileLayer[];
  summary: {
    total_latency_ms: number;
    peak_memory_bytes: number;
    mean_compression_ratio: number;
    tokens_per_second: number;
  };
}

export function buildProfileArgv(input: {
  model: string;
  method: string;
  bits: number;
  prompt: string;
  maxTokens: number;
}): string[] {
  return [
    '-m', 'veloxquant_mlx', 'profile',
    '--model', input.model,
    '--method', input.method,
    '--bits', String(input.bits),
    '--prompt', input.prompt,
    '--max-tokens', String(input.maxTokens),
  ];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseProfilePayload(value: unknown): ProfilePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Profile output is not an object.');
  const raw = value as Record<string, unknown>;
  if (raw.schema_version !== 1 || typeof raw.model !== 'string' || typeof raw.method !== 'string' ||
      !isFiniteNumber(raw.bits) || raw.accounting_only !== true || typeof raw.accounting_note !== 'string' ||
      !Array.isArray(raw.layers) || !raw.summary || typeof raw.summary !== 'object') {
    throw new Error('Profile output does not match schema_version 1.');
  }
  for (const layer of raw.layers) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) throw new Error('Profile output contains an invalid layer.');
    const row = layer as Record<string, unknown>;
    if (!isFiniteNumber(row.layer_index) || !isFiniteNumber(row.compute_latency_ms) || typeof row.is_fused !== 'boolean' ||
        !isFiniteNumber(row.peak_memory_bytes) || !isFiniteNumber(row.compression_ratio)) {
      throw new Error('Profile output contains an invalid layer.');
    }
  }
  const summary = raw.summary as Record<string, unknown>;
  if (![summary.total_latency_ms, summary.peak_memory_bytes, summary.mean_compression_ratio, summary.tokens_per_second].every(isFiniteNumber)) {
    throw new Error('Profile output contains an invalid summary.');
  }
  return value as ProfilePayload;
}
