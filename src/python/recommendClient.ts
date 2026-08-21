/**
 * Thin client over `python -m veloxquant_mlx recommend ... --json`.
 *
 * Always uses execFile with an argv array — never a shell string — so that
 * none of the user-influenced flag values (chip/ram/model-class/goal and the
 * optional advanced integers) can be interpreted by a shell.
 */
import { execFile } from 'node:child_process';

export type Chip = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
export type RamGb = 8 | 16 | 24 | 32 | 36 | 48 | 64 | 96 | 128 | 192 | 256 | 512;
export type ModelClass = '1B' | '3B' | '7B' | '14B' | '32B';
export type Goal = 'everyday' | 'max_key_accounting' | 'max_context' | 'best_quality' | 'constant_memory';

export interface RecommendRequestInput {
  chip: Chip;
  ramGb: RamGb;
  modelClass: ModelClass;
  goal: Goal;
  seqLen?: number;
  nLayers?: number;
  nKvHeads?: number;
  headDim?: number;
}

export interface RecommendRequest {
  chip: Chip;
  ram_gb: RamGb;
  model_class: ModelClass;
  goal: Goal;
  seq_len: number;
  n_layers: number;
  n_kv_heads: number;
  head_dim: number;
}

export interface Recommendation {
  method: string;
  knobs: Record<string, string | number | boolean>;
  key_accounting_ratio: number;
  resident_savings_likely: boolean;
  kv_fp16_mb: number;
  kv_compressed_mb_estimate: number;
  warnings: string[];
  rationale: string;
}

export interface RecommendResponse {
  request: RecommendRequest;
  recommendation: Recommendation;
}

export type RecommendErrorKind =
  | 'module-not-found'
  | 'unsupported-flag' // pre-0.42.0 package: --json/recommend not recognized
  | 'non-zero-exit'
  | 'spawn-failed';

export class RecommendError extends Error {
  readonly kind: RecommendErrorKind;
  readonly stderr: string;
  readonly command: string[];

  constructor(kind: RecommendErrorKind, message: string, stderr: string, command: string[]) {
    super(message);
    this.name = 'RecommendError';
    this.kind = kind;
    this.stderr = stderr;
    this.command = command;
  }
}

export function buildRecommendArgv(input: RecommendRequestInput): string[] {
  const argv = [
    '-m',
    'veloxquant_mlx',
    'recommend',
    '--chip',
    input.chip,
    '--ram-gb',
    String(input.ramGb),
    '--model-class',
    input.modelClass,
    '--goal',
    input.goal,
  ];
  if (input.seqLen !== undefined) {
    argv.push('--seq-len', String(input.seqLen));
  }
  if (input.nLayers !== undefined) {
    argv.push('--n-layers', String(input.nLayers));
  }
  if (input.nKvHeads !== undefined) {
    argv.push('--n-kv-heads', String(input.nKvHeads));
  }
  if (input.headDim !== undefined) {
    argv.push('--head-dim', String(input.headDim));
  }
  argv.push('--json');
  return argv;
}

/** Renders the full command as a copy-pasteable shell line (display only). */
export function formatCommandForDisplay(interpreterPath: string, argv: string[]): string {
  const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  return [quote(interpreterPath), ...argv.map(quote)].join(' ');
}

function execFileAsync(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(error);
        return;
      }
      const code = (error as { code?: number } | null)?.code ?? 0;
      resolve({ stdout, stderr, code: typeof code === 'number' ? code : 0 });
    });
  });
}

/** Fast `python -c "import veloxquant_mlx"` preflight check. */
export async function checkModuleImportable(interpreterPath: string): Promise<boolean> {
  try {
    const { code } = await execFileAsync(interpreterPath, ['-c', 'import veloxquant_mlx'], 8000);
    return code === 0;
  } catch {
    return false;
  }
}

export async function getRecommendation(
  interpreterPath: string,
  input: RecommendRequestInput
): Promise<RecommendResponse> {
  const argv = buildRecommendArgv(input);

  let result: { stdout: string; stderr: string; code: number | null };
  try {
    result = await execFileAsync(interpreterPath, argv, 20000);
  } catch (err) {
    throw new RecommendError(
      'spawn-failed',
      `Could not run the resolved Python interpreter: ${(err as Error).message}`,
      '',
      [interpreterPath, ...argv]
    );
  }

  const { stdout, stderr, code } = result;

  if (code !== 0) {
    if (/ModuleNotFoundError.*veloxquant_mlx/i.test(stderr)) {
      throw new RecommendError('module-not-found', 'VeloxQuant-MLX is not installed in this interpreter.', stderr, [
        interpreterPath,
        ...argv,
      ]);
    }
    if (/unrecognized arguments|invalid choice|no such option|argument --json/i.test(stderr)) {
      throw new RecommendError(
        'unsupported-flag',
        'The installed VeloxQuant-MLX version does not support `recommend --json`.',
        stderr,
        [interpreterPath, ...argv]
      );
    }
    throw new RecommendError('non-zero-exit', `veloxquant_mlx recommend exited with code ${code}.`, stderr, [
      interpreterPath,
      ...argv,
    ]);
  }

  try {
    return JSON.parse(stdout) as RecommendResponse;
  } catch {
    throw new RecommendError('non-zero-exit', 'Could not parse JSON output from veloxquant_mlx recommend.', stderr, [
      interpreterPath,
      ...argv,
    ]);
  }
}
