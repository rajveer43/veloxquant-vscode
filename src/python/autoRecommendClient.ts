/**
 * Client over `python -m veloxquant_mlx recommend --auto --model-config ...
 * --json` (veloxquant-mlx >= 0.91.0), the hardware-aware auto-selector.
 *
 * execFile with an argv array only. Supports cancellation via AbortSignal
 * because `--auto` can be slow on first run (hardware probe).
 */
import { execFile } from 'node:child_process';
import { MIN_AUTO_VERSION } from './versionCheck';

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
  peakBytes?: number;
  workspaceBytes?: number;
}

/** Where a candidate's numbers came from, as reported by the planner. */
export type AutoEvidence = 'analytic' | 'empirical' | 'hybrid' | 'fallback';
const EVIDENCE_VALUES: readonly string[] = ['analytic', 'empirical', 'hybrid', 'fallback'];

export interface AutoRankedEntry {
  method: string;
  score: number;
  memory?: AutoMemory;
  warnings: string[];
  /** Absent on installs that predate the field. */
  evidence?: AutoEvidence;
  objectiveScores?: Record<string, number>;
}

export interface AutoRecommendResult {
  objective?: string;
  fallbackUsed: boolean;
  /** Only when the installed package reports why it fell back. */
  fallbackReason?: string;
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

export function buildAutoArgv(input: AutoRecommendInput, mode: 'json' | 'explain' = 'json'): string[] {
  const argv = ['-m', 'veloxquant_mlx', 'recommend', '--auto', '--model-config', input.modelConfigPath];
  if (input.objective) argv.push('--objective', input.objective);
  if (input.context !== undefined) argv.push('--context', String(input.context));
  if (input.generation !== undefined) argv.push('--generation', String(input.generation));
  if (!input.probe) argv.push('--no-probe');
  argv.push(mode === 'explain' ? '--explain' : '--json');
  return argv;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function parseObjectiveScores(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const scores: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw)) {
    const n = finite(value);
    if (n !== undefined) scores[name] = n;
  }
  return Object.keys(scores).length > 0 ? scores : undefined;
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
    peakBytes: finite(m.peak_bytes),
    workspaceBytes: finite(m.workspace_bytes),
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
  const o = raw as { ranked?: unknown; objective?: unknown; fallback_used?: unknown; fallback_reason?: unknown } | null;
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
      evidence: typeof e.evidence === 'string' && EVIDENCE_VALUES.includes(e.evidence) ? (e.evidence as AutoEvidence) : undefined,
      objectiveScores: parseObjectiveScores(e.objective_scores),
    });
  }
  return {
    objective: typeof o.objective === 'string' ? o.objective : undefined,
    fallbackUsed: o.fallback_used === true,
    fallbackReason: typeof o.fallback_reason === 'string' && o.fallback_reason ? o.fallback_reason : undefined,
    ranked,
  };
}

async function runAuto(
  interpreterPath: string,
  argv: string[],
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<string> {
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
      throw new AutoRecommendError('unsupported-flag', 'The installed VeloxQuant-MLX does not support `recommend --auto` (needs ' + MIN_AUTO_VERSION + '+).', result.stderr);
    }
    throw new AutoRecommendError('non-zero-exit', `veloxquant_mlx recommend --auto exited with code ${result.code}.`, result.stderr);
  }
  return result.stdout;
}

export async function getAutoRecommendation(
  interpreterPath: string,
  input: AutoRecommendInput,
  signal?: AbortSignal,
  timeoutMs = 180000
): Promise<AutoRecommendResult> {
  return parseAutoRecommend(await runAuto(interpreterPath, buildAutoArgv(input), signal, timeoutMs));
}

/** Runs `recommend --auto ... --explain` and returns the planner's plain-text analysis. */
export async function explainAutoRecommendation(
  interpreterPath: string,
  input: AutoRecommendInput,
  signal?: AbortSignal,
  timeoutMs = 180000
): Promise<string> {
  return runAuto(interpreterPath, buildAutoArgv(input, 'explain'), signal, timeoutMs);
}
