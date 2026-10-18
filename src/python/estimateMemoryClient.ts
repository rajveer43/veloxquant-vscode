/**
 * Thin client over `python -m veloxquant_mlx estimate-memory ... --json`
 * (veloxquant-mlx >= 0.91.0). Reports the analytic KV-cache footprint of every
 * strategy for a model and workload before any weights are loaded.
 *
 * Uses execFile with an argv array — never a shell string. The parser is
 * defensive: malformed strategy entries are dropped (and reported through
 * `onDropped`) rather than failing the whole response, but a response whose
 * entries are all malformed is a schema mismatch and fails as `parse-failed`.
 */
import { execFile } from 'node:child_process';

export interface EstimateMemoryInput {
  /** Path to a HuggingFace-style model config.json. */
  modelConfigPath: string;
  context: number;
  /** Limit to the N best strategies. */
  top?: number;
  /** Benchmark-database dir; matching measured records are reported under `empirical`. */
  benchmarkDir?: string;
}

export interface StrategyMemoryEstimate {
  method: string;
  baselineBytes: number;
  compressedBytes: number;
  residentBytes: number;
  savingsPercent: number;
  confidence?: string;
  assumptions: string[];
  peakBytes?: number;
  workspaceBytes?: number;
  reductionRatio?: number;
  /** 'measured' when a benchmark record for this method matched; otherwise the analytic 'estimated' figure. */
  source: 'measured' | 'estimated';
  measured?: MeasuredRecord;
}

/** The fields of a benchmark-database record (`BenchmarkRecord.to_dict()`) worth showing; all optional. */
export interface MeasuredRecord {
  memoryBytes?: number;
  /** Ratio of measured bytes to the fp16 baseline (0.19 = 81% savings). */
  memoryReduction?: number;
  throughputTokS?: number;
  latencyMsPerToken?: number;
  perplexityDelta?: number;
  chip?: string;
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
  if (input.benchmarkDir) {
    argv.push('--benchmark-dir', input.benchmarkDir);
  }
  argv.push('--json');
  return argv;
}

function parseMeasured(raw: unknown): MeasuredRecord | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  return {
    memoryBytes: num(r.memory_bytes),
    memoryReduction: num(r.memory_reduction),
    throughputTokS: num(r.throughput_tok_s),
    latencyMsPerToken: num(r.latency_ms_per_token),
    perplexityDelta: num(r.perplexity_delta),
    chip: typeof r.chip === 'string' ? r.chip : undefined,
  };
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Parses `estimate-memory --json` stdout. Throws EstimateMemoryError('parse-failed') if it is not the expected shape. */
export function parseEstimateMemory(stdout: string, onDropped?: (method: string) => void): EstimateMemoryResult {
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

  const empiricalRaw = (raw as { empirical?: unknown }).empirical as Record<string, unknown> | null | undefined;
  const strategies: StrategyMemoryEstimate[] = [];
  for (const [method, entry] of Object.entries(strategiesRaw)) {
    const e = entry as Record<string, unknown> | null;
    const baselineBytes = num(e?.baseline_bytes);
    const compressedBytes = num(e?.compressed_bytes);
    const residentBytes = num(e?.resident_bytes);
    const savingsPercent = num(e?.savings_percent);
    if (baselineBytes === undefined || compressedBytes === undefined || residentBytes === undefined || savingsPercent === undefined) {
      onDropped?.(method);
      continue;
    }
    const measured = parseMeasured(empiricalRaw?.[method]);
    strategies.push({
      method,
      baselineBytes,
      compressedBytes,
      residentBytes,
      savingsPercent,
      confidence: typeof e?.confidence === 'string' ? e.confidence : undefined,
      assumptions: Array.isArray(e?.assumptions) ? e.assumptions.filter((a): a is string => typeof a === 'string') : [],
      peakBytes: num(e?.peak_bytes),
      workspaceBytes: num(e?.workspace_bytes),
      reductionRatio: num(e?.reduction_ratio),
      source: measured ? 'measured' : 'estimated',
      measured,
    });
  }
  const total = Object.keys(strategiesRaw).length;
  if (total > 0 && strategies.length === 0) {
    throw new EstimateMemoryError(
      'parse-failed',
      `Estimate unavailable: schema mismatch (all ${total} strategy entries were malformed). Check the backend package version.`,
      ''
    );
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

export async function getMemoryEstimate(
  interpreterPath: string,
  input: EstimateMemoryInput,
  onDropped?: (method: string) => void
): Promise<EstimateMemoryResult> {
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
  const parsed = parseEstimateMemory(stdout, onDropped);
  return parsed;
}
