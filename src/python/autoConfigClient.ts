/**
 * Client over `python -m veloxquant_mlx auto-config --json`
 * (`veloxquant_mlx/cli/auto_config.py`), which picks a KV config from the
 * device's memory and a workload shape. It chooses from a small pool
 * (turboquant_rvq, kivi, kvquant, gear) and never reports "does not fit" itself,
 * so `fitsUncompressed` is computed here from the fp16 KV size.
 *
 * execFile with an argv array only.
 */
import { execFile } from 'node:child_process';

export interface WorkloadShape {
  headDim: number;
  seqLen: number;
  nLayers: number;
  nKvHeads: number;
  batchSize?: number;
}

export type AutoConfigErrorKind = 'module-not-found' | 'unsupported-command' | 'non-zero-exit' | 'parse-failed' | 'spawn-failed';

export class AutoConfigError extends Error {
  constructor(readonly kind: AutoConfigErrorKind, message: string, readonly stderr: string) {
    super(message);
    this.name = 'AutoConfigError';
  }
}

export interface AutoConfigResult {
  method: string;
  /** The selected method's own knobs; `method` and `head_dim` are excluded. */
  knobs: Record<string, string | number | boolean>;
  reason: string;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  /** Uncompressed fp16 K+V bytes for the workload. */
  fp16KvBytes: number;
  fitsUncompressed: boolean;
}

const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Reads the attention shape from a HF-style config.json; undefined when a required field is missing. */
export function shapeFromModelConfig(raw: unknown, seqLen: number): WorkloadShape | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const c = raw as Record<string, unknown>;
  const nLayers = c.num_hidden_layers;
  const heads = c.num_attention_heads;
  if (!positiveInt(nLayers) || !positiveInt(heads) || !positiveInt(seqLen)) return undefined;
  const kvHeads = positiveInt(c.num_key_value_heads) ? c.num_key_value_heads : heads;
  const headDim = positiveInt(c.head_dim)
    ? c.head_dim
    : positiveInt(c.hidden_size) && c.hidden_size % heads === 0 ? c.hidden_size / heads : undefined;
  if (headDim === undefined) return undefined;
  return { headDim, seqLen, nLayers, nKvHeads: kvHeads };
}

export function buildAutoConfigArgv(shape: WorkloadShape): string[] {
  return [
    '-m', 'veloxquant_mlx', 'auto-config', '--json',
    '--head-dim', String(shape.headDim),
    '--seq-len', String(shape.seqLen),
    '--n-layers', String(shape.nLayers),
    '--batch-size', String(shape.batchSize ?? 1),
    '--n-kv-heads', String(shape.nKvHeads),
  ];
}

/** Parses `auto-config --json`; throws AutoConfigError('parse-failed') on an unexpected shape. */
export function parseAutoConfig(stdout: string, shape: WorkloadShape): AutoConfigResult {
  const fail = (message: string): never => {
    throw new AutoConfigError('parse-failed', message, '');
  };
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return fail('Could not parse JSON output from veloxquant_mlx auto-config.');
  }
  const o = raw as { config?: Record<string, unknown>; hardware?: Record<string, unknown>; reason?: unknown } | null;
  const config = o?.config;
  if (!config || typeof config.method !== 'string') return fail('auto-config output has no config.method.');
  const total = o?.hardware?.total_memory_bytes;
  const active = o?.hardware?.active_memory_bytes;
  if (typeof total !== 'number' || typeof active !== 'number') return fail('auto-config output has no hardware memory figures.');

  const knobs: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === 'method' || key === 'head_dim') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') knobs[key] = value;
  }
  const fp16KvBytes = 2 * 2 * shape.nLayers * shape.nKvHeads * shape.headDim * shape.seqLen * (shape.batchSize ?? 1);
  const freeMemoryBytes = Math.max(0, total - active);
  return {
    method: config.method,
    knobs,
    reason: typeof o?.reason === 'string' ? o.reason : '',
    totalMemoryBytes: total,
    freeMemoryBytes,
    fp16KvBytes,
    fitsUncompressed: fp16KvBytes <= freeMemoryBytes,
  };
}

export async function getAutoConfig(interpreterPath: string, shape: WorkloadShape, timeoutMs = 60000): Promise<AutoConfigResult> {
  const { stdout, stderr, code, spawnError } = await new Promise<{ stdout: string; stderr: string; code: number; spawnError?: Error }>((resolve) => {
    execFile(interpreterPath, buildAutoConfigArgv(shape), { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, out, err) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ stdout: '', stderr: '', code: 1, spawnError: error });
        return;
      }
      const c = (error as { code?: number } | null)?.code;
      resolve({ stdout: out, stderr: err, code: error ? (typeof c === 'number' ? c : 1) : 0 });
    });
  });
  if (spawnError) throw new AutoConfigError('spawn-failed', `Could not run the resolved Python interpreter: ${spawnError.message}`, '');
  if (code !== 0) {
    if (/ModuleNotFoundError.*veloxquant_mlx/i.test(stderr)) {
      throw new AutoConfigError('module-not-found', 'VeloxQuant-MLX is not installed in this interpreter.', stderr);
    }
    if (/Unknown command|invalid choice|unrecognized arguments/i.test(stderr + stdout)) {
      throw new AutoConfigError('unsupported-command', 'The installed VeloxQuant-MLX does not provide `auto-config`. Upgrade the package.', stderr);
    }
    throw new AutoConfigError('non-zero-exit', `veloxquant_mlx auto-config exited with code ${code}.`, stderr);
  }
  return parseAutoConfig(stdout, shape);
}
