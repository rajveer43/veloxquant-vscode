import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AutoConfigError, buildAutoConfigArgv, parseAutoConfig, shapeFromModelConfig } from '../../src/python/autoConfigClient';

const shape = { headDim: 128, seqLen: 8192, nLayers: 32, nKvHeads: 8 };
const payload = (over: Record<string, unknown> = {}) => JSON.stringify({
  workload: {},
  hardware: { total_memory_bytes: 16e9, active_memory_bytes: 1e9 },
  config: { method: 'kivi', head_dim: 128, bit_width_inlier: 2, kivi_group_size: 32 },
  reason: 'mid-length context',
  ...over,
});

test('shapeFromModelConfig derives head_dim and falls back to MHA kv heads', () => {
  assert.deepEqual(
    shapeFromModelConfig({ num_hidden_layers: 32, num_attention_heads: 32, num_key_value_heads: 8, hidden_size: 4096 }, 4096),
    { headDim: 128, seqLen: 4096, nLayers: 32, nKvHeads: 8 }
  );
  assert.equal(shapeFromModelConfig({ num_hidden_layers: 2, num_attention_heads: 4, hidden_size: 64, head_dim: 32 }, 10)?.nKvHeads, 4);
  assert.equal(shapeFromModelConfig({ num_hidden_layers: 2 }, 10), undefined);
  assert.equal(shapeFromModelConfig([], 10), undefined);
});

test('buildAutoConfigArgv passes every shape field as its own argv entry', () => {
  assert.deepEqual(buildAutoConfigArgv(shape), [
    '-m', 'veloxquant_mlx', 'auto-config', '--json', '--head-dim', '128', '--seq-len', '8192',
    '--n-layers', '32', '--batch-size', '1', '--n-kv-heads', '8',
  ]);
});

test('parseAutoConfig splits method from knobs and computes the fit', () => {
  const r = parseAutoConfig(payload(), shape);
  assert.equal(r.method, 'kivi');
  assert.deepEqual(r.knobs, { bit_width_inlier: 2, kivi_group_size: 32 });
  assert.equal(r.fp16KvBytes, 2 * 2 * 32 * 8 * 128 * 8192);
  assert.equal(r.freeMemoryBytes, 15e9);
  assert.equal(r.fitsUncompressed, true);
});

test('parseAutoConfig reports a workload that does not fit uncompressed', () => {
  const r = parseAutoConfig(payload({ hardware: { total_memory_bytes: 8e9, active_memory_bytes: 7.5e9 } }), shape);
  assert.equal(r.fitsUncompressed, false);
});

test('parseAutoConfig rejects bad output', () => {
  assert.throws(() => parseAutoConfig('nope', shape), (e: unknown) => e instanceof AutoConfigError && e.kind === 'parse-failed');
  assert.throws(() => parseAutoConfig('{}', shape), { kind: 'parse-failed' });
});

test('contract: real auto-config output parses', () => {
  const file = path.join(__dirname, '..', 'fixtures', 'veloxquant-0.94.10', 'auto-config.json');
  const r = parseAutoConfig(fs.readFileSync(file, 'utf8'), shape);
  assert.ok(r.method.length > 0 && Object.keys(r.knobs).length > 0);
});
