/**
 * Runs the extension's real parsers against CLI JSON captured from a pinned
 * veloxquant-mlx (scripts/gen-fixtures.sh). Set VQ_FIXTURE_DIR to check a
 * freshly generated directory instead of the newest committed one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseMethods } from '../../src/python/methodsClient';
import { parseAutoRecommend } from '../../src/python/autoRecommendClient';
import { parseEstimateMemory } from '../../src/python/estimateMemoryClient';
import { parseRuleset } from '../../src/python/rulesetClient';
import { parseProfileHardware } from '../../src/hardware/profileHardware';

const fixturesRoot = path.join(__dirname, '..', 'fixtures');

function fixtureDir(): string {
  if (process.env.VQ_FIXTURE_DIR) return path.resolve(process.env.VQ_FIXTURE_DIR);
  const versions = fs.readdirSync(fixturesRoot).filter((d) => d.startsWith('veloxquant-'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  assert.ok(versions.length > 0, 'no fixtures; run scripts/gen-fixtures.sh');
  return path.join(fixturesRoot, versions[versions.length - 1]);
}

const dir = fixtureDir();
const read = (name: string): string => fs.readFileSync(path.join(dir, name), 'utf8');
const json = (name: string): Record<string, unknown> => JSON.parse(read(name)) as Record<string, unknown>;

test(`contract (${path.basename(dir)}): methods --json parses and carries maturity`, () => {
  const result = parseMethods(read('methods.json'));
  assert.ok(result.methods.length > 0);
  assert.equal(typeof result.defaultServeMethod, 'string');
  assert.ok(result.methods.every((m) => ['stable', 'beta', 'experimental'].includes(m.maturity)));
});

test('contract: recommend --auto --json parses', () => {
  const result = parseAutoRecommend(read('recommend-auto.json'));
  assert.ok(result.ranked.length > 0);
  const top = result.ranked[0];
  assert.equal(typeof top.method, 'string');
  assert.equal(typeof top.score, 'number');
});

test('contract: estimate-memory --json parses', () => {
  const result = parseEstimateMemory(read('estimate-memory.json'));
  assert.ok(result.strategies.length > 0);
});

test('contract: recommend --dump-ruleset parses every list', () => {
  const o = json('ruleset.json');
  for (const key of ['chips', 'allowed_ram_gb', 'model_classes', 'goals']) {
    assert.ok(Array.isArray(o[key]) && (o[key] as unknown[]).length > 0, `ruleset.${key}`);
  }
  assert.ok(parseRuleset(read('ruleset.json')));
});

test('contract: profile-hardware --json parses', () => {
  const profile = parseProfileHardware(read('profile-hardware.json'));
  assert.ok(profile?.chip);
  assert.equal(typeof profile?.totalMemoryBytes, 'number');
  assert.equal(typeof profile?.metalAvailable, 'boolean');
  assert.equal(typeof profile?.peakMemoryBandwidthGbps, 'number');
});

test('contract: legacy recommend --json keeps the keys the panel reads', () => {
  const o = json('recommend-legacy.json');
  assert.ok(o.request && o.recommendation);
  const rec = o.recommendation as Record<string, unknown>;
  assert.equal(typeof rec.method, 'string');
  assert.ok(rec.knobs && typeof rec.knobs === 'object');
  for (const key of ['key_accounting_ratio', 'kv_fp16_mb', 'kv_compressed_mb_estimate']) {
    assert.equal(typeof rec[key], 'number', `recommendation.${key}`);
  }
});
