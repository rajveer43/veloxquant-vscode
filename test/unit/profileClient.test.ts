import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileArgv, describeProfiledMethod, methodReadsBitWidth, parseProfilePayload } from '../../src/server/profileProtocol';

const validPayload = {
  schema_version: 1,
  model: 'mlx-community/test',
  method: 'kivi',
  bits: 2,
  accounting_only: true,
  accounting_note: 'Accounting only.',
  layers: [{ layer_index: 0, compute_latency_ms: 1.2, is_fused: true, peak_memory_bytes: 1024, compression_ratio: 2 }],
  summary: { total_latency_ms: 1.2, peak_memory_bytes: 1024, mean_compression_ratio: 2, tokens_per_second: 10 },
};

test('buildProfileArgv keeps user values as distinct argv entries', () => {
  const argv = buildProfileArgv({ model: 'org/model name', method: 'kivi', bits: 2, prompt: 'hello; exit 1', maxTokens: 64 });
  assert.deepEqual(argv, [
    '-m', 'veloxquant_mlx', 'profile', '--model', 'org/model name', '--method', 'kivi', '--bits', '2',
    '--prompt', 'hello; exit 1', '--max-tokens', '64',
  ]);
});

test('parseProfilePayload accepts schema version 1', () => {
  assert.deepEqual(parseProfilePayload(validPayload), validPayload);
});

test('parseProfilePayload rejects malformed layers and summaries', () => {
  assert.throws(() => parseProfilePayload({ ...validPayload, schema_version: 2 }), /schema_version/);
  assert.throws(() => parseProfilePayload({ ...validPayload, layers: [{ layer_index: '0' }] }), /invalid layer/);
  assert.throws(() => parseProfilePayload({ ...validPayload, summary: { ...validPayload.summary, tokens_per_second: null } }), /invalid summary/);
});

test('methodReadsBitWidth is true only for methods that read bit_width_inlier', () => {
  for (const method of ['kivi', 'kivi_sink', 'polar', 'spectral', 'turboquant_mse', 'turboquant_prod', 'turboquant_rvq']) {
    assert.ok(methodReadsBitWidth(method), method);
  }
  for (const method of ['kvquant', 'skvq', 'palu', 'snapkv']) assert.ok(!methodReadsBitWidth(method), method);
});

test('describeProfiledMethod shows the bit width only where it applies', () => {
  assert.equal(describeProfiledMethod('kivi', 4), '`kivi` (4-bit)');
  assert.equal(describeProfiledMethod('kvquant', 2), '`kvquant`');
});

test('buildProfileArgv still passes --bits for methods that ignore it (the CLI sets it regardless)', () => {
  const argv = buildProfileArgv({ model: 'm', method: 'kvquant', bits: 2, prompt: 'p', maxTokens: 4 });
  assert.deepEqual(argv.slice(argv.indexOf('--bits'), argv.indexOf('--bits') + 2), ['--bits', '2']);
});
