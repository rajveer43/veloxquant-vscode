import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAutoArgv, parseAutoRecommend } from '../../src/python/autoRecommendClient';

test('buildAutoArgv: minimal request uses --no-probe and --json', () => {
  assert.deepEqual(buildAutoArgv({ modelConfigPath: '/m/config.json' }), [
    '-m', 'veloxquant_mlx', 'recommend', '--auto', '--model-config', '/m/config.json', '--no-probe', '--json',
  ]);
});

test('buildAutoArgv: full request, probe enabled drops --no-probe', () => {
  const argv = buildAutoArgv({ modelConfigPath: '/a b/c.json', objective: 'memory', context: 8192, generation: 256, probe: true });
  assert.deepEqual(argv, [
    '-m', 'veloxquant_mlx', 'recommend', '--auto', '--model-config', '/a b/c.json',
    '--objective', 'memory', '--context', '8192', '--generation', '256', '--json',
  ]);
});

const fixture = JSON.stringify({
  mode: 'auto',
  objective: 'balanced',
  fallback_used: false,
  ranked: [
    {
      method: 'turboquant', score: 0.91, objective_scores: {}, evidence: 'analytic',
      memory: { baseline_bytes: 1000, compressed_bytes: 300, resident_bytes: 500, confidence: 'high', savings_percent: 50, assumptions: ['fp16'] },
      warnings: ['needs warmup'],
    },
    { method: 'fp16', score: 0.5, memory: { baseline_bytes: 'bad' }, warnings: [] },
    { score: 1 },
  ],
});

test('parseAutoRecommend: keeps valid entries, tolerates bad memory, drops entries with no method', () => {
  const r = parseAutoRecommend(fixture);
  assert.equal(r.objective, 'balanced');
  assert.equal(r.fallbackUsed, false);
  assert.equal(r.ranked.length, 2);
  assert.equal(r.ranked[0].method, 'turboquant');
  assert.equal(r.ranked[0].memory?.savingsPercent, 50);
  assert.deepEqual(r.ranked[0].warnings, ['needs warmup']);
  assert.equal(r.ranked[1].memory, undefined);
});

test('parseAutoRecommend: rejects non-JSON and missing ranked', () => {
  assert.throws(() => parseAutoRecommend('x'), { kind: 'parse-failed' });
  assert.throws(() => parseAutoRecommend('{}'), { kind: 'parse-failed' });
});
