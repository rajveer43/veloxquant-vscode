import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendArgv, formatCommandForDisplay } from '../../src/python/recommendClient';

test('buildRecommendArgv: required fields only, no advanced flags when blank', () => {
  const argv = buildRecommendArgv({
    chip: 'M4',
    ramGb: 16,
    modelClass: '7B',
    goal: 'everyday',
  });
  assert.deepEqual(argv, [
    '-m',
    'veloxquant_mlx',
    'recommend',
    '--chip',
    'M4',
    '--ram-gb',
    '16',
    '--model-class',
    '7B',
    '--goal',
    'everyday',
    '--json',
  ]);
});

test('buildRecommendArgv: includes advanced flags only when provided', () => {
  const argv = buildRecommendArgv({
    chip: 'M2',
    ramGb: 32,
    modelClass: '14B',
    goal: 'max_context',
    seqLen: 8192,
    nLayers: 40,
  });
  assert.ok(argv.includes('--seq-len'));
  assert.ok(argv.includes('8192'));
  assert.ok(argv.includes('--n-layers'));
  assert.ok(argv.includes('40'));
  assert.ok(!argv.includes('--n-kv-heads'));
  assert.ok(!argv.includes('--head-dim'));
});

test('buildRecommendArgv: includes --batch-size only when provided', () => {
  const withBatch = buildRecommendArgv({
    chip: 'M3',
    ramGb: 24,
    modelClass: '3B',
    goal: 'everyday',
    batchSize: 4,
  });
  assert.ok(withBatch.includes('--batch-size'));
  assert.ok(withBatch.includes('4'));

  const withoutBatch = buildRecommendArgv({ chip: 'M3', ramGb: 24, modelClass: '3B', goal: 'everyday' });
  assert.ok(!withoutBatch.includes('--batch-size'));
});

test('buildRecommendArgv: never produces a single shell string (argv array only)', () => {
  const argv = buildRecommendArgv({ chip: 'M1', ramGb: 8, modelClass: '1B', goal: 'best_quality' });
  assert.ok(Array.isArray(argv));
  for (const item of argv) {
    assert.equal(typeof item, 'string');
  }
});

test('formatCommandForDisplay: quotes interpreter path with spaces', () => {
  const cmd = formatCommandForDisplay('/path with space/python3', ['-m', 'veloxquant_mlx']);
  assert.equal(cmd, '"/path with space/python3" -m veloxquant_mlx');
});

test('formatCommandForDisplay: no quoting when no spaces present', () => {
  const cmd = formatCommandForDisplay('/usr/bin/python3', ['-m', 'veloxquant_mlx', '--json']);
  assert.equal(cmd, '/usr/bin/python3 -m veloxquant_mlx --json');
});
