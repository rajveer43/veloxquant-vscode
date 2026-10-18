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
    peakBytes: undefined, workspaceBytes: undefined, reductionRatio: undefined, source: 'estimated', measured: undefined,
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

test('buildEstimateMemoryArgv: passes --benchmark-dir before --json', () => {
  const argv = buildEstimateMemoryArgv({ modelConfigPath: '/c.json', context: 4096, benchmarkDir: '/my bench' });
  assert.deepEqual(argv.slice(-3), ['--benchmark-dir', '/my bench', '--json']);
});

test('parseEstimateMemory: tags a method with a matching empirical record as measured', () => {
  const r = parseEstimateMemory(JSON.stringify({
    strategies: {
      kivi: { baseline_bytes: 10, compressed_bytes: 5, resident_bytes: 6, savings_percent: 50, peak_bytes: 9, workspace_bytes: 1, reduction_ratio: 2 },
      polar: { baseline_bytes: 10, compressed_bytes: 5, resident_bytes: 6, savings_percent: 50 },
    },
    empirical: { kivi: { memory_bytes: 4, memory_reduction: 0.4, throughput_tok_s: 50, chip: 'M4' } },
  }));
  const [kivi, polar] = r.strategies;
  assert.equal(kivi.source, 'measured');
  assert.deepEqual(kivi.measured, { memoryBytes: 4, memoryReduction: 0.4, throughputTokS: 50, latencyMsPerToken: undefined, perplexityDelta: undefined, chip: 'M4' });
  assert.equal(kivi.peakBytes, 9);
  assert.equal(kivi.reductionRatio, 2);
  assert.equal(polar.source, 'estimated');
  assert.equal(polar.measured, undefined);
});

test('buildEstimateMemoryArgv: passes --benchmark-dir before --json', () => {
  const argv = buildEstimateMemoryArgv({ modelConfigPath: '/c.json', context: 4096, benchmarkDir: '/my bench' });
  assert.deepEqual(argv.slice(-3), ['--benchmark-dir', '/my bench', '--json']);
});

test('parseEstimateMemory: tags a method with a matching empirical record as measured', () => {
  const r = parseEstimateMemory(JSON.stringify({
    strategies: {
      kivi: { baseline_bytes: 10, compressed_bytes: 5, resident_bytes: 6, savings_percent: 50, peak_bytes: 9, workspace_bytes: 1, reduction_ratio: 2 },
      polar: { baseline_bytes: 10, compressed_bytes: 5, resident_bytes: 6, savings_percent: 50 },
    },
    empirical: { kivi: { memory_bytes: 4, memory_reduction: 0.4, throughput_tok_s: 50, chip: 'M4' } },
  }));
  const [kivi, polar] = r.strategies;
  assert.equal(kivi.source, 'measured');
  assert.equal(kivi.measured?.memoryBytes, 4);
  assert.equal(kivi.measured?.chip, 'M4');
  assert.equal(kivi.peakBytes, 9);
  assert.equal(kivi.reductionRatio, 2);
  assert.equal(polar.source, 'estimated');
  assert.equal(polar.measured, undefined);
});
