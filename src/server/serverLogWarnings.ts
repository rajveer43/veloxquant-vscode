/**
 * Recognises library warnings in inference-server log lines. Kept free of
 * `vscode` imports so it can be unit tested.
 */

/** `QFiltersKVCache._check_retention` (cache/qfilters_cache.py), emitted once per cache via `warnings.warn`. */
const QFILTERS_LOW_RETENTION = /QFiltersKVCache: retention dropped to/;

export function isQFiltersLowRetentionWarning(text: string): boolean {
  return QFILTERS_LOW_RETENTION.test(text);
}
