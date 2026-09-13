/**
 * Thin HTTP client over the local control-plane server's JSON API
 * (`veloxquant_mlx/ui/server.py`). Always targets 127.0.0.1 — there is no
 * setting that can redirect this to another host, matching the server's own
 * hardcoded loopback bind.
 */
import * as http from 'node:http';

/** Default `veloxquant.panelPort` value, shared by every site that reads that setting. */
export const DEFAULT_PANEL_PORT = 7860;

export interface MethodInfo {
  name: string;
  family: string;
  serve_tier: string;
  serve_tier_label: string;
  is_servable: boolean;
  blurb: string;
  config_fields: string[];
  field_schema: Array<{
    name: string;
    type: string;
    default: unknown;
    optional: boolean;
    help: string | null;
  }>;
  coverage: string;
  coverage_label: string;
  paper_deviation: string | null;
  is_adapted: boolean;
  unsupported_reason: string | null;
  docs_url: string | null;
}

export interface MethodsResponse {
  default_serve_method: string;
  accounting_only: boolean;
  methods: MethodInfo[];
}

function isFieldSchema(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const field = value as Record<string, unknown>;
  return typeof field.name === 'string' && typeof field.type === 'string' && typeof field.optional === 'boolean' &&
    (field.help === null || typeof field.help === 'string') && 'default' in field;
}

function isMethodInfo(value: unknown): value is MethodInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const method = value as Record<string, unknown>;
  return typeof method.name === 'string' && typeof method.family === 'string' && typeof method.serve_tier === 'string' &&
    typeof method.serve_tier_label === 'string' && typeof method.is_servable === 'boolean' && typeof method.blurb === 'string' &&
    Array.isArray(method.config_fields) && method.config_fields.every((field) => typeof field === 'string') &&
    Array.isArray(method.field_schema) && method.field_schema.every(isFieldSchema) && typeof method.coverage === 'string' &&
    typeof method.coverage_label === 'string' && (method.paper_deviation === null || typeof method.paper_deviation === 'string') &&
    typeof method.is_adapted === 'boolean' && (method.unsupported_reason === null || typeof method.unsupported_reason === 'string') &&
    (method.docs_url === null || typeof method.docs_url === 'string');
}

/** Reject broken discovery payloads rather than treating missing flags as unsupported methods. */
export function parseMethodsResponse(value: unknown): MethodsResponse {
  const result = assertShape<MethodsResponse>(value, ['default_serve_method', 'accounting_only', 'methods'], '/api/methods');
  if (typeof result.default_serve_method !== 'string' || typeof result.accounting_only !== 'boolean' ||
      !Array.isArray(result.methods) || result.methods.some((method) => !isMethodInfo(method))) {
    throw new Error('Invalid method-discovery response from /api/methods. Check the backend package version.');
  }
  return result;
}

export function methodAvailabilityWarning(data: MethodsResponse): string | undefined {
  if (data.methods.some((method) => method.is_servable)) return undefined;
  const reasons = [...new Set(data.methods.map((method) => method.unsupported_reason).filter(Boolean))];
  const detail = reasons.length > 0 ? `${reasons.join('; ')} ` : '';
  return `No serving methods are available. ${detail}Check dependencies in the Python environment running the panel, then restart the panel backend to repeat its cached checks.`;
}

export interface StatusResponse {
  state: 'stopped' | 'starting' | 'running' | 'error';
  pid: number | null;
  ready: Record<string, unknown> | null;
  error: string | null;
  config: Record<string, unknown>;
  version?: string;
}

export interface VersionedStatusResponse extends StatusResponse {
  version: string;
}

export interface ModelsResponse {
  models: Array<{ repo_id: string; size_bytes: number; size_label: string; is_mlx: boolean }>;
}

export interface LogsResponse {
  lines: Array<{ stream: string; text: string; ts: number }>;
  total: number;
}

export interface MemoryResponse {
  source: 'measured';
  process: { rss_bytes: number | null; unavailable_reason: string | null };
  mlx: { active_bytes: number | null; peak_bytes: number | null; unavailable_reason: string | null };
  note: string;
}

const LOOPBACK_HOST = '127.0.0.1';

function requestJson<T>(port: number, path: string, options: { method?: string; timeoutMs?: number; body?: unknown } = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const req = http.request(
      {
        host: LOOPBACK_HOST,
        port,
        path,
        method: options.method ?? 'GET',
        timeout: options.timeoutMs ?? 3000,
        headers: bodyStr
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
            return;
          }
          try {
            resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

const STATUS_STATES = new Set(['stopped', 'starting', 'running', 'error']);

/**
 * True only if `value` actually has the shape of a `StatusResponse` — used
 * to distinguish the real VeloxQuant-MLX panel from some unrelated process
 * that happens to be listening on the configured port and answers `/api/status`
 * with an unrelated 2xx/JSON body (or an empty one, since `requestJson`
 * resolves `{}` for an empty response).
 */
export function isStatusResponse(value: unknown, requireVersion = false): value is StatusResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.state === 'string' &&
    STATUS_STATES.has(v.state) &&
    (v.pid === null || typeof v.pid === 'number') &&
    (v.ready === null || (typeof v.ready === 'object' && !Array.isArray(v.ready))) &&
    (v.error === null || typeof v.error === 'string') &&
    typeof v.config === 'object' &&
    v.config !== null &&
    !Array.isArray(v.config) &&
    (!requireVersion || typeof v.version === 'string')
  );
}

/**
 * Minimal shape guard shared by the endpoints below that don't have a
 * dedicated validator: true only if `value` is a non-null, non-array object
 * with all of `keys` present. Catches the same "foreign process answers on
 * this port" bug class `isStatusResponse` guards against for `/api/status` —
 * not a full structural validator, but enough to reject an unrelated
 * service's JSON body instead of returning it as if it were real panel data.
 */
function hasShape(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return keys.every((key) => key in v);
}

function assertShape<T>(value: unknown, keys: string[], path: string): T {
  if (!hasShape(value, keys)) {
    throw new Error(`Unexpected response from ${path}: does not look like a VeloxQuant-MLX panel.`);
  }
  return value as T;
}

export class PanelApiClient {
  constructor(private readonly port: number) {}

  async getStatus(timeoutMs = 1500): Promise<VersionedStatusResponse> {
    const status = await requestJson<StatusResponse>(this.port, '/api/status', { timeoutMs });
    if (!isStatusResponse(status, true)) {
      throw new Error('Unexpected response from /api/status: does not look like a VeloxQuant-MLX panel.');
    }
    return status as VersionedStatusResponse;
  }

  async isReachable(timeoutMs = 800): Promise<boolean> {
    try {
      await this.getStatus(timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  async getMethods(): Promise<MethodsResponse> {
    const path = '/api/methods';
    // Cold discovery imports and probes every cache; it can exceed the normal request timeout.
    const result = await requestJson<unknown>(this.port, path, { timeoutMs: 60000 });
    return parseMethodsResponse(result);
  }

  async getModels(): Promise<ModelsResponse> {
    const path = '/api/models';
    const result = assertShape<ModelsResponse>(await requestJson<unknown>(this.port, path), ['models'], path);
    if (!Array.isArray(result.models) || result.models.some((model) => !model || typeof model.repo_id !== 'string' ||
        typeof model.size_bytes !== 'number' || typeof model.size_label !== 'string' || typeof model.is_mlx !== 'boolean')) {
      throw new Error(`Unexpected response from ${path}: invalid model list.`);
    }
    return result;
  }

  async getMemory(): Promise<MemoryResponse> {
    const path = '/api/memory';
    const result = assertShape<MemoryResponse>(await requestJson<unknown>(this.port, path), ['source', 'process', 'mlx', 'note'], path);
    const nullableNumber = (value: unknown) => value === null || typeof value === 'number';
    const nullableString = (value: unknown) => value === null || typeof value === 'string';
    if (result.source !== 'measured' || typeof result.note !== 'string' || !result.process || !result.mlx ||
        !nullableNumber(result.process.rss_bytes) || !nullableString(result.process.unavailable_reason) ||
        !nullableNumber(result.mlx.active_bytes) || !nullableNumber(result.mlx.peak_bytes) || !nullableString(result.mlx.unavailable_reason)) {
      throw new Error(`Unexpected response from ${path}: invalid memory report.`);
    }
    return result;
  }

  async getLogs(since = 0): Promise<LogsResponse> {
    const path = `/api/logs?since=${since}`;
    const result = assertShape<LogsResponse>(await requestJson<unknown>(this.port, path), ['lines', 'total'], path);
    if (!Array.isArray(result.lines) || typeof result.total !== 'number' || result.lines.some((line) => !line ||
        typeof line.stream !== 'string' || typeof line.text !== 'string' || typeof line.ts !== 'number')) {
      throw new Error(`Unexpected response from ${path}: invalid log payload.`);
    }
    return result;
  }

  async start(config: Record<string, unknown>): Promise<StatusResponse> {
    const path = '/api/start';
    const result = await requestJson<unknown>(this.port, path, { method: 'POST', body: config });
    if (!isStatusResponse(result)) {
      throw new Error(`Unexpected response from ${path}: does not look like a VeloxQuant-MLX panel.`);
    }
    return result;
  }

  async stop(): Promise<StatusResponse> {
    const path = '/api/stop';
    const result = await requestJson<unknown>(this.port, path, { method: 'POST' });
    if (!isStatusResponse(result)) {
      throw new Error(`Unexpected response from ${path}: does not look like a VeloxQuant-MLX panel.`);
    }
    return result;
  }

  baseUrl(): string {
    return `http://${LOOPBACK_HOST}:${this.port}/`;
  }
}
