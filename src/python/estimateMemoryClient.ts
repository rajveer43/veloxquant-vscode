/**
 * Thin client over `python -m veloxquant_mlx estimate-memory ... --json`
 * (veloxquant-mlx >= 0.91.0). Reports the analytic KV-cache footprint of every
 * strategy for a model and workload before any weights are loaded.
 *
 * Uses execFile with an argv array — never a shell string. The parser is
 * defensive: unknown or malformed strategy entries are dropped rather than
 * failing the whole response.
 */
import { execFile } from 'node:child_process';

export interface EstimateMemoryInput {
  /** Path to a HuggingFace-style model config.json. */
  modelConfigPath: string;
  context: number;
  /** Limit to the N best strategies. */
  top?: number;
}

export interface StrategyMemoryEstimate {
  method: string;
  baselineBytes: number;
  compressedBytes: number;
  residentBytes: number;
  savingsPercent: number;
  confidence?: string;
  assumptions: string[];
}

export interface EstimateMemoryResult {
  model?: unknown;
  workload?: unknown;
  strategies: StrategyMemoryEstimate[];
}

export type EstimateMemoryErrorKind = 'module-not-found' | 'unsupported-command' | 'non-zero-exit' | 'parse-failed' | 'spawn-failed';

export class EstimateMemoryError extends Error {
  readonly kind: EstimateMemoryErrorKind;
  readonly stderr: string;

  constructor(kind: EstimateMemoryErrorKind, message: string, stderr: string) {
    super(message);
    this.name = 'EstimateMemoryError';
    this.kind = kind;
    this.stderr = stderr;
  }
}

export function buildEstimateMemoryArgv(input: EstimateMemoryInput): string[] {
  const argv = [
    '-m',
    'veloxquant_mlx',
    'estimate-memory',
    '--model-config',
    input.modelConfigPath,
    '--context',
    String(input.context),
  ];
  if (input.top !== undefined) {
    argv.push('--top', String(input.top));
  }
  argv.push('--json');
  return argv;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Parses `estimate-memory --json` stdout. Throws EstimateMemoryError('parse-failed') if it is not the expected shape. */
export function parseEstimateMemory(stdout: string): EstimateMemoryResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new EstimateMemoryError('parse-failed', 'Could not parse JSON output from veloxquant_mlx estimate-memory.', '');
  }
  const strategiesRaw = (raw as { strategies?: unknown } | null)?.strategies;
  if (!strategiesRaw || typeof strategiesRaw !== 'object' || Array.isArray(strategiesRaw)) {
    throw new EstimateMemoryError('parse-failed', 'estimate-memory output has no "strategies" object.', '');
  }

  const strategies: StrategyMemoryEstimate[] = [];
  for (const [method, entry] of Object.entries(strategiesRaw)) {
    const e = entry as Record<string, unknown> | null;
    const baselineBytes = num(e?.baseline_bytes);
    const compressedBytes = num(e?.compressed_bytes);
    const residentBytes = num(e?.resident_bytes);
    const savingsPercent = num(e?.savings_percent);
    if (baselineBytes === undefined || compressedBytes === undefined || residentBytes === undefined || savingsPercent === undefined) {
      continue;
    }
    strategies.push({
      method,
      baselineBytes,
      compressedBytes,
      residentBytes,
      savingsPercent,
      confidence: typeof e?.confidence === 'string' ? e.confidence : undefined,
      assumptions: Array.isArray(e?.assumptions) ? e.assumptions.filter((a): a is string => typeof a === 'string') : [],
    });
  }
  const obj = raw as { model?: unknown; workload?: unknown };
  return { model: obj.model, workload: obj.workload, strategies };
}

function execFileAsync(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(error);
        return;
      }
      const code = (error as { code?: number } | null)?.code ?? 0;
      resolve({ stdout, stderr, code: typeof code === 'number' ? code : 1 });
    });
  });
}

export async function getMemoryEstimate(interpreterPath: string, input: EstimateMemoryInput): Promise<EstimateMemoryResult> {
  const argv = buildEstimateMemoryArgv(input);
  let result: { stdout: string; stderr: string; code: number };
  try {
    result = await execFileAsync(interpreterPath, argv, 20000);
  } catch (err) {
    throw new EstimateMemoryError('spawn-failed', `Could not run the resolved Python interpreter: ${(err as Error).message}`, '');
  }
  const { stdout, stderr, code } = result;
  if (code !== 0) {
    if (/ModuleNotFoundError.*veloxquant_mlx/i.test(stderr)) {
      throw new EstimateMemoryError('module-not-found', 'VeloxQuant-MLX is not installed in this interpreter.', stderr);
    }
    if (/invalid choice: 'estimate-memory'|unrecognized arguments|No module named veloxquant_mlx\.__main__/i.test(stderr)) {
      throw new EstimateMemoryError('unsupported-command', 'The installed VeloxQuant-MLX does not support `estimate-memory` (needs 0.91.0+).', stderr);
    }
    throw new EstimateMemoryError('non-zero-exit', `veloxquant_mlx estimate-memory exited with code ${code}.`, stderr);
  }
  const parsed = parseEstimateMemory(stdout);
  return parsed;
}
