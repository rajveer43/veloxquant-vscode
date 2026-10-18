import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEstimateMemoryArgv, parseEstimateMemory } from '../../src/python/estimateMemoryClient';

test('buildEstimateMemoryArgv: omits --top when unset', () => {
  assert.deepEqual(buildEstimateMemoryArgv({ modelConfigPath: '/m/config.json', context: 8192 }), [
    '-m', 'veloxquant_mlx', 'estimate-memory', '--model-config', '/m/config.json', '--context', '8192', '--json',
  ]);
});

test('buildEstimateMemoryArgv: includes --top and keeps paths with spaces as one arg', () => {
  const argv = buildEstimateMemoryArgv({ modelConfigPath: '/my models/config.json', context: 4096, top: 3 });
  assert.ok(argv.includes('/my models/config.json'));
  assert.deepEqual(argv.slice(-3), ['--top', '3', '--json'].slice(0, 3));
});

const fixture = JSON.stringify({
  model: { n_layers: 32 },
  workload: { context: 8192 },
  strategies: {
    turboquant: {
      baseline_bytes: 1000, compressed_bytes: 250, resident_bytes: 400, savings_percent: 60,
      confidence: 'high', assumptions: ['fp16 baseline', 7],
    },
    broken: { baseline_bytes: 'x' },
  },
  empirical: null,
});

test('parseEstimateMemory: parses valid strategies and drops malformed ones', () => {
  const r = parseEstimateMemory(fixture);
  assert.equal(r.strategies.length, 1);
  assert.deepEqual(r.strategies[0], {
    method: 'turboquant', baselineBytes: 1000, compressedBytes: 250, residentBytes: 400,
    savingsPercent: 60, confidence: 'high', assumptions: ['fp16 baseline'],
  });
});

test('parseEstimateMemory: reports each dropped entry', () => {
  const dropped: string[] = [];
  parseEstimateMemory(fixture, (m) => dropped.push(m));
  assert.deepEqual(dropped, ['broken']);
});

test('parseEstimateMemory: throws parse-failed when every entry is invalid', () => {
  const allBad = JSON.stringify({ strategies: { a: { baseline_bytes: 'x' }, b: null, c: 5 } });
  assert.throws(() => parseEstimateMemory(allBad), { kind: 'parse-failed', message: /schema mismatch/ });
});

test('parseEstimateMemory: an empty strategies object is not a schema mismatch', () => {
  assert.deepEqual(parseEstimateMemory('{"strategies":{}}').strategies, []);
});

test('parseEstimateMemory: rejects non-JSON and missing strategies', () => {
  assert.throws(() => parseEstimateMemory('nope'), { kind: 'parse-failed' });
  assert.throws(() => parseEstimateMemory('{"strategies":[]}'), { kind: 'parse-failed' });
});
