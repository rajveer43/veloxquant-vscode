/**
 * Thin HTTP client over the local control-plane server's JSON API
 * (`veloxquant_mlx/ui/server.py`). Always targets 127.0.0.1 — there is no
 * setting that can redirect this to another host, matching the server's own
 * hardcoded loopback bind.
 */
import * as http from 'node:http';

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

export interface StatusResponse {
  state: 'stopped' | 'starting' | 'running' | 'error';
  pid: number | null;
  ready: boolean;
  error: string | null;
  config: Record<string, unknown>;
  version: string;
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

export class PanelApiClient {
  constructor(private readonly port: number) {}

  async getStatus(timeoutMs = 1500): Promise<StatusResponse> {
    return requestJson<StatusResponse>(this.port, '/api/status', { timeoutMs });
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
    return requestJson<MethodsResponse>(this.port, '/api/methods');
  }

  async getModels(): Promise<{ models: unknown[] }> {
    return requestJson(this.port, '/api/models');
  }

  async getMemory(): Promise<Record<string, unknown>> {
    return requestJson(this.port, '/api/memory');
  }

  async getLogs(since = 0): Promise<{ lines: unknown[]; total: number }> {
    return requestJson(this.port, `/api/logs?since=${since}`);
  }

  async start(config: Record<string, unknown>): Promise<StatusResponse> {
    return requestJson<StatusResponse>(this.port, '/api/start', { method: 'POST', body: config });
  }

  async stop(): Promise<StatusResponse> {
    return requestJson<StatusResponse>(this.port, '/api/stop', { method: 'POST' });
  }

  baseUrl(): string {
    return `http://${LOOPBACK_HOST}:${this.port}/`;
  }
}
