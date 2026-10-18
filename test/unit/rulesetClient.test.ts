import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_RULESET, parseRuleset } from '../../src/python/rulesetClient';

const valid = {
  version: 1,
  allowed_ram_gb: [16, 32],
  model_classes: ['7B', '70B'],
  goals: ['everyday'],
  chips: ['M1', 'M5'],
};

test('parseRuleset: reads chips, RAM, model classes and goals', () => {
  assert.deepEqual(parseRuleset(JSON.stringify(valid)), {
    chips: ['M1', 'M5'], ramGb: [16, 32], modelClasses: ['7B', '70B'], goals: ['everyday'],
  });
});

test('parseRuleset: a malformed list falls back individually', () => {
  const r = parseRuleset(JSON.stringify({ ...valid, chips: 'M4', allowed_ram_gb: [] }));
  assert.deepEqual(r?.chips, FALLBACK_RULESET.chips);
  assert.deepEqual(r?.ramGb, FALLBACK_RULESET.ramGb);
  assert.deepEqual(r?.modelClasses, ['7B', '70B']);
});

test('parseRuleset: rejects non-JSON and unrelated objects', () => {
  assert.equal(parseRuleset('nope'), undefined);
  assert.equal(parseRuleset('[]'), undefined);
  assert.equal(parseRuleset('{"foo":1}'), undefined);
});
