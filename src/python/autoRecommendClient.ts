/**
 * Client over `python -m veloxquant_mlx recommend --auto --model-config ...
 * --json` (veloxquant-mlx >= 0.91.0), the hardware-aware auto-selector.
 *
 * execFile with an argv array only. Supports cancellation via AbortSignal
 * because `--auto` can be slow on first run (hardware probe).
 */
import { execFile } from 'node:child_process';

export type AutoObjective = 'memory' | 'latency' | 'throughput' | 'quality' | 'balanced';
export const AUTO_OBJECTIVES: readonly AutoObjective[] = ['memory', 'latency', 'throughput', 'quality', 'balanced'];

export interface AutoRecommendInput {
  modelConfigPath: string;
  objective?: AutoObjective;
  context?: number;
  generation?: number;
  /** Run the (slower) live hardware probe. Default false → `--no-probe`. */
  probe?: boolean;
}

export interface AutoMemory {
  baselineBytes: number;
  compressedBytes: number;
  residentBytes: number;
  savingsPercent: number;
  confidence?: string;
  assumptions: string[];
}

export interface AutoRankedEntry {
  method: string;
  score: number;
  memory?: AutoMemory;
  warnings: string[];
}

export interface AutoRecommendResult {
  objective?: string;
  fallbackUsed: boolean;
  ranked: AutoRankedEntry[];
}

export type AutoRecommendErrorKind =
  | 'module-not-found'
  | 'unsupported-flag'
  | 'cancelled'
  | 'non-zero-exit'
  | 'parse-failed'
  | 'spawn-failed';

export class AutoRecommendError extends Error {
  constructor(
    readonly kind: AutoRecommendErrorKind,
    message: string,
    readonly stderr: string
  ) {
    super(message);
    this.name = 'AutoRecommendError';
  }
}

export function buildAutoArgv(input: AutoRecommendInput): string[] {
  const argv = ['-m', 'veloxquant_mlx', 'recommend', '--auto', '--model-config', input.modelConfigPath];
  if (input.objective) argv.push('--objective', input.objective);
  if (input.context !== undefined) argv.push('--context', String(input.context));
  if (input.generation !== undefined) argv.push('--generation', String(input.generation));
  if (!input.probe) argv.push('--no-probe');
  argv.push('--json');
  return argv;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function parseAutoMemory(raw: unknown): AutoMemory | undefined {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return undefined;
  const baselineBytes = finite(m.baseline_bytes);
  const compressedBytes = finite(m.compressed_bytes);
  const residentBytes = finite(m.resident_bytes);
  const savingsPercent = finite(m.savings_percent);
  if (baselineBytes === undefined || compressedBytes === undefined || residentBytes === undefined || savingsPercent === undefined) {
    return undefined;
  }
  return {
    baselineBytes,
    compressedBytes,
    residentBytes,
    savingsPercent,
    confidence: typeof m.confidence === 'string' ? m.confidence : undefined,
    assumptions: strings(m.assumptions),
  };
}

/** Parses `recommend --auto --json` stdout; throws AutoRecommendError('parse-failed') when `ranked` is absent. */
export function parseAutoRecommend(stdout: string): AutoRecommendResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new AutoRecommendError('parse-failed', 'Could not parse JSON output from recommend --auto.', '');
  }
  const o = raw as { ranked?: unknown; objective?: unknown; fallback_used?: unknown } | null;
  if (!o || !Array.isArray(o.ranked)) {
    throw new AutoRecommendError('parse-failed', 'recommend --auto output has no "ranked" list.', '');
  }
  const ranked: AutoRankedEntry[] = [];
  for (const entry of o.ranked) {
    const e = entry as Record<string, unknown> | null;
    if (!e || typeof e.method !== 'string') continue;
    ranked.push({
      method: e.method,
      score: finite(e.score) ?? 0,
      memory: parseAutoMemory(e.memory),
      warnings: strings(e.warnings),
    });
  }
  return {
    objective: typeof o.objective === 'string' ? o.objective : undefined,
    fallbackUsed: o.fallback_used === true,
    ranked,
  };
}

export async function getAutoRecommendation(
  interpreterPath: string,
  input: AutoRecommendInput,
  signal?: AbortSignal,
  timeoutMs = 180000
): Promise<AutoRecommendResult> {
  const argv = buildAutoArgv(input);
  const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    execFile(interpreterPath, argv, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      const errno = error as (NodeJS.ErrnoException & { name?: string }) | null;
      if (errno && (errno.name === 'AbortError' || errno.code === 'ABORT_ERR')) {
        reject(new AutoRecommendError('cancelled', 'Auto recommendation cancelled.', ''));
        return;
      }
      if (errno && errno.code === 'ENOENT') {
        reject(new AutoRecommendError('spawn-failed', `Could not run the resolved Python interpreter: ${errno.message}`, ''));
        return;
      }
      const code = (error as { code?: number } | null)?.code;
      resolve({ stdout, stderr, code: error ? (typeof code === 'number' ? code : 1) : 0 });
    });
  });

  if (result.code !== 0) {
    if (/ModuleNotFoundError.*veloxquant_mlx/i.test(result.stderr)) {
      throw new AutoRecommendError('module-not-found', 'VeloxQuant-MLX is not installed in this interpreter.', result.stderr);
    }
    if (/unrecognized arguments|no such option/i.test(result.stderr)) {
      throw new AutoRecommendError('unsupported-flag', 'The installed VeloxQuant-MLX does not support `recommend --auto` (needs 0.91.0+).', result.stderr);
    }
    throw new AutoRecommendError('non-zero-exit', `veloxquant_mlx recommend --auto exited with code ${result.code}.`, result.stderr);
  }
  return parseAutoRecommend(result.stdout);
}
