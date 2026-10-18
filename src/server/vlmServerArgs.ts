/**
 * Argv for `python -m veloxquant_mlx vlm-serve` (veloxquant-mlx >= 0.94).
 * `--method/--bits/--seed` are consumed by VeloxQuant; everything else is
 * forwarded to the `mlx_vlm` server CLI (`--host`, `--port`, `--model`).
 * Kept free of `vscode` imports so it can be unit tested.
 */
export interface VlmServeOptions {
  model: string;
  port: number;
  method?: string;
  bits?: number;
}

export function buildVlmServeArgv(options: VlmServeOptions): string[] {
  const argv = ['-m', 'veloxquant_mlx', 'vlm-serve'];
  if (options.method) argv.push('--method', options.method);
  if (options.bits !== undefined) argv.push('--bits', String(options.bits));
  // Loopback only: mlx_vlm defaults to 0.0.0.0.
  argv.push('--host', '127.0.0.1', '--port', String(options.port), '--model', options.model);
  return argv;
}

/** True when the process output says mlx-vlm (the optional `vlm` extra) is missing. */
export function isMlxVlmMissing(output: string): boolean {
  return /vlm-serve requires mlx-vlm/.test(output);
}
