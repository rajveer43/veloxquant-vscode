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
  docs_url: string;
}

export interface MethodsResponse {
  default_serve_method: string;
  accounting_only: boolean;
  methods: MethodInfo[];
}

/** Reject broken discovery payloads rather than treating missing flags as unsupported methods. */
export function parseMethodsResponse(value: unknown): MethodsResponse {
  const result = assertShape<MethodsResponse>(value, ['default_serve_method', 'accounting_only', 'methods'], '/api/methods');
  if (typeof result.default_serve_method !== 'string' || typeof result.accounting_only !== 'boolean' ||
      !Array.isArray(result.methods) || result.methods.some((m) => !m || typeof m.name !== 'string' ||
        typeof m.is_servable !== 'boolean' || (m.unsupported_reason != null && typeof m.unsupported_reason !== 'string'))) {
    throw new Error('Invalid method-discovery response from /api/methods. Check the backend package version.');
  }
  return result;
}

export function methodAvailabilityWarning(data: MethodsResponse): string | undefined {
  if (data.methods.some((method) => method.is_servable)) return undefined;
  const reasons = [...new Set(data.methods.map((method) => method.unsupported_reason).filter(Boolean))];
  return `No serving methods are available. ${reasons.join('; ')} Check dependencies in the Python environment running the panel, then restart the panel backend to repeat its cached checks.`;
}

export interface StatusResponse {
  state: 'stopped' | 'starting' | 'running' | 'error';
  pid: number | null;
  ready: boolean;
  error: string | null;
  config: Record<string, unknown>;
  version: string;
}

export interface ProfileLayerRow {
  layer: number;
  quantize_ms: number | null;
  dequantize_ms: number | null;
  write_ms: number | null;
  peak_memory_bytes: number | null;
  compression_ratio: number | null;
  tokens_per_sec: number | null;
}

export interface ProfileResponse {
  method: string;
  layers: ProfileLayerRow[];
  table: string;
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
function isStatusResponse(value: unknown): value is StatusResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.state === 'string' &&
    STATUS_STATES.has(v.state) &&
    (v.pid === null || typeof v.pid === 'number') &&
    typeof v.config === 'object' &&
    v.config !== null
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

  async getStatus(timeoutMs = 1500): Promise<StatusResponse> {
    const status = await requestJson<StatusResponse>(this.port, '/api/status', { timeoutMs });
    if (!isStatusResponse(status)) {
      throw new Error('Unexpected response from /api/status: does not look like a VeloxQuant-MLX panel.');
    }
    return status;
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

  async getModels(): Promise<{ models: unknown[] }> {
    const path = '/api/models';
    const result = await requestJson<unknown>(this.port, path);
    return assertShape<{ models: unknown[] }>(result, ['models'], path);
  }

  async getMemory(): Promise<Record<string, unknown>> {
    return requestJson(this.port, '/api/memory');
  }

  async getLogs(since = 0): Promise<{ lines: unknown[]; total: number }> {
    const path = `/api/logs?since=${since}`;
    const result = await requestJson<unknown>(this.port, path);
    return assertShape<{ lines: unknown[]; total: number }>(result, ['lines', 'total'], path);
  }

  async getProfile(): Promise<ProfileResponse> {
    const path = '/api/profile';
    const result = await requestJson<unknown>(this.port, path, { timeoutMs: 10000 });
    return assertShape<ProfileResponse>(result, ['method', 'layers'], path);
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
