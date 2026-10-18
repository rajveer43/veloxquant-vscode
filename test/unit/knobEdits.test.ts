import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeKnobEdits, parseKnobInput, profileSetArgs } from '../../src/insert/knobEdits';
import { buildProfileArgv } from '../../src/server/profileProtocol';
import { buildFullSnippet } from '../../src/insert/snippetBuilder';

const fields = [
  { name: 'bit_width_inlier', type: 'int', default: 2, help: null },
  { name: 'kivi_group_size', type: 'int', default: 32, help: null },
];

test('parseKnobInput parses by schema type and rejects bad input', () => {
  assert.equal(parseKnobInput('int', ' 64 '), 64);
  assert.equal(parseKnobInput('int', '6.4'), undefined);
  assert.equal(parseKnobInput('float', '0.5'), 0.5);
  assert.equal(parseKnobInput('float', 'abc'), undefined);
  assert.equal(parseKnobInput('bool', 'true'), true);
  assert.equal(parseKnobInput('bool', 'maybe'), undefined);
  assert.equal(parseKnobInput('str', 'x'), 'x');
  assert.equal(parseKnobInput('int', ''), undefined);
});

test('mergeKnobEdits keeps recommended knobs and only non-default extras', () => {
  const merged = mergeKnobEdits({ bit_width_inlier: 2 }, { bit_width_inlier: 4, kivi_group_size: 32 }, fields);
  assert.deepEqual(merged, { bit_width_inlier: 4 });
  assert.deepEqual(mergeKnobEdits({ bit_width_inlier: 2 }, { kivi_group_size: 64 }, fields), { bit_width_inlier: 2, kivi_group_size: 64 });
});

test('acceptance: kivi_group_size=64 reaches the snippet and the profile argv', () => {
  const knobs = mergeKnobEdits({ bit_width_inlier: 2 }, { kivi_group_size: 64 }, fields);
  assert.match(buildFullSnippet('kivi', knobs), /kivi_group_size=64/);
  const argv = buildProfileArgv({ model: 'm', method: 'kivi', bits: 2, prompt: 'p', maxTokens: 8, overrides: knobs });
  assert.deepEqual(argv.slice(-2), ['--set', 'kivi_group_size=64']);
  assert.equal(argv.filter((a) => a === '--set').length, 1, 'bit_width_inlier travels via --bits, not --set');
});

test('profileSetArgs formats bools for the CLI and skips flag-backed fields', () => {
  assert.deepEqual(profileSetArgs({ seed: 1, bit_width_inlier: 4, flag: true }), ['--set', 'flag=true']);
});
