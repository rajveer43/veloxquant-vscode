/**
 * Thin client over `python -m veloxquant_mlx methods --json`
 * (`veloxquant_mlx/cli/methods.py`, schema_version 1). Unlike the
 * `@veloxquant/sdk` `MethodInfo`, each entry carries `maturity`,
 * `config_fields`, `field_schema`, `coverage` and `paper_deviation`
 * (maturity needs veloxquant-mlx >= MIN_METHOD_METADATA_VERSION).
 *
 * Uses execFile with an argv array — never a shell string.
 */
import { execFile } from 'node:child_process';

export type Maturity = 'stable' | 'beta' | 'experimental';
const MATURITIES: readonly string[] = ['stable', 'beta', 'experimental'];

export interface FieldSchemaEntry {
  name: string;
  type: string;
  default: unknown;
  optional: boolean;
  help: string | null;
}

export interface CliMethodInfo {
  name: string;
  family: string;
  serveTier: string;
  serveTierLabel: string;
  maturity: Maturity;
  isServable: boolean;
  blurb: string;
  configFields: string[];
  fieldSchema: FieldSchemaEntry[];
  coverage: string;
  coverageLabel: string;
  paperDeviation: string | null;
  isAdapted: boolean;
  unsupportedReason: string | null;
  docsUrl: string | null;
}

export interface CliMethodsResult {
  defaultServeMethod: string;
  accountingOnly: boolean;
  methods: CliMethodInfo[];
}

export interface MethodsQuery {
  servableOnly?: boolean;
  family?: string;
}

export type MethodsErrorKind = 'module-not-found' | 'unsupported-command' | 'non-zero-exit' | 'parse-failed' | 'spawn-failed';

export class MethodsError extends Error {
  constructor(readonly kind: MethodsErrorKind, message: string, readonly stderr: string) {
    super(message);
    this.name = 'MethodsError';
  }
}

export function buildMethodsArgv(query: MethodsQuery = {}): string[] {
  const argv = ['-m', 'veloxquant_mlx', 'methods', '--json'];
  if (query.servableOnly) argv.push('--servable-only');
  if (query.family) argv.push('--family', query.family);
  return argv;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

function parseField(value: unknown): FieldSchemaEntry | undefined {
  if (!isObject(value)) return undefined;
  if (typeof value.name !== 'string' || typeof value.type !== 'string' || typeof value.optional !== 'boolean' ||
      !isNullableString(value.help) || !('default' in value)) return undefined;
  return { name: value.name, type: value.type, default: value.default, optional: value.optional, help: value.help };
}

function parseMethod(value: unknown): CliMethodInfo | undefined {
  if (!isObject(value)) return undefined;
  const m = value;
  if (typeof m.name !== 'string' || typeof m.family !== 'string' || typeof m.serve_tier !== 'string' ||
      typeof m.serve_tier_label !== 'string' || typeof m.maturity !== 'string' || !MATURITIES.includes(m.maturity) ||
      typeof m.is_servable !== 'boolean' || typeof m.blurb !== 'string' || typeof m.coverage !== 'string' ||
      typeof m.coverage_label !== 'string' || typeof m.is_adapted !== 'boolean' || !isNullableString(m.paper_deviation) ||
      !isNullableString(m.unsupported_reason) || !isNullableString(m.docs_url)) return undefined;
  if (!Array.isArray(m.config_fields) || !m.config_fields.every((f) => typeof f === 'string')) return undefined;
  if (!Array.isArray(m.field_schema)) return undefined;
  const fieldSchema = m.field_schema.map(parseField);
  if (fieldSchema.some((f) => f === undefined)) return undefined;
  return {
    name: m.name,
    family: m.family,
    serveTier: m.serve_tier,
    serveTierLabel: m.serve_tier_label,
    maturity: m.maturity as Maturity,
    isServable: m.is_servable,
    blurb: m.blurb,
    configFields: m.config_fields as string[],
    fieldSchema: fieldSchema as FieldSchemaEntry[],
    coverage: m.coverage,
    coverageLabel: m.coverage_label,
    paperDeviation: m.paper_deviation,
    isAdapted: m.is_adapted,
    unsupportedReason: m.unsupported_reason,
    docsUrl: m.docs_url,
  };
}

/** Parses `methods --json` stdout. Throws MethodsError('parse-failed') on a wrong schema_version or any malformed entry. */
export function parseMethods(stdout: string): CliMethodsResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new MethodsError('parse-failed', 'Could not parse JSON output from veloxquant_mlx methods.', '');
  }
  if (!isObject(raw) || raw.schema_version !== 1) {
    throw new MethodsError('parse-failed', 'Unsupported `methods --json` schema (expected schema_version 1). Check the backend package version.', '');
  }
  if (typeof raw.default_serve_method !== 'string' || typeof raw.accounting_only !== 'boolean' || !Array.isArray(raw.methods)) {
    throw new MethodsError('parse-failed', '`methods --json` output is missing required fields.', '');
  }
  const methods = raw.methods.map(parseMethod);
  const bad = methods.findIndex((m) => m === undefined);
  if (bad !== -1) {
    throw new MethodsError('parse-failed', `\`methods --json\` entry ${bad} is malformed (maturity/field_schema need a newer backend package).`, '');
  }
  return { defaultServeMethod: raw.default_serve_method, accountingOnly: raw.accounting_only, methods: methods as CliMethodInfo[] };
}

export async function getMethods(interpreterPath: string, query: MethodsQuery = {}): Promise<CliMethodsResult> {
  const argv = buildMethodsArgv(query);
  const { stdout, stderr, code, spawnError } = await new Promise<{ stdout: string; stderr: string; code: number; spawnError?: Error }>((resolve) => {
    execFile(interpreterPath, argv, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (error, out, err) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ stdout: '', stderr: '', code: 1, spawnError: error });
        return;
      }
      const c = (error as { code?: number } | null)?.code ?? 0;
      resolve({ stdout: out, stderr: err, code: typeof c === 'number' ? c : 1 });
    });
  });
  if (spawnError) throw new MethodsError('spawn-failed', `Could not run the resolved Python interpreter: ${spawnError.message}`, '');
  if (code !== 0) {
    if (/ModuleNotFoundError.*veloxquant_mlx/i.test(stderr)) {
      throw new MethodsError('module-not-found', 'VeloxQuant-MLX is not installed in this interpreter.', stderr);
    }
    if (/invalid choice: 'methods'|unrecognized arguments|No module named veloxquant_mlx\.__main__/i.test(stderr)) {
      throw new MethodsError('unsupported-command', 'The installed VeloxQuant-MLX does not support `methods --json`.', stderr);
    }
    throw new MethodsError('non-zero-exit', `veloxquant_mlx methods exited with code ${code}.`, stderr);
  }
  return parseMethods(stdout);
}
