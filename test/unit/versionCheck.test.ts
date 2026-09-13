import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVersion,
  FEATURE_MINIMUMS,
  isVersionSupported,
  MIN_SUPPORTED_VERSION,
  parseVersion,
} from '../../src/python/versionCheck';

test('MIN_SUPPORTED_VERSION is 0.42.0', () => {
  assert.equal(MIN_SUPPORTED_VERSION, '0.42.0');
});

test('isVersionSupported: exact minimum is supported', () => {
  assert.equal(isVersionSupported('0.42.0'), true);
});

test('isVersionSupported: newer than minimum is supported', () => {
  assert.equal(isVersionSupported('0.53.0'), true);
  assert.equal(isVersionSupported('1.0.0'), true);
  assert.equal(isVersionSupported('0.42.1'), true);
});

test('isVersionSupported: older than minimum is not supported', () => {
  assert.equal(isVersionSupported('0.41.9'), false);
  assert.equal(isVersionSupported('0.30.0'), false);
});

test('isVersionSupported: unparsable version fails open (treated as supported)', () => {
  assert.equal(isVersionSupported('not-a-version'), true);
});

test('feature minimums reflect the first upstream contracts', () => {
  assert.deepEqual(FEATURE_MINIMUMS, {
    recommend: '0.42.0',
    panel: '0.46.0',
    serve: '0.46.0',
    profile: '0.68.0',
    worker: '0.81.0',
  });
});

test('parseVersion accepts whitespace and prerelease/build suffixes', () => {
  assert.deepEqual(parseVersion(' 0.83.0-rc.1 '), [0, 83, 0]);
  assert.deepEqual(parseVersion('0.83.0+build.7'), [0, 83, 0]);
  assert.equal(parseVersion('0.83'), undefined);
  assert.equal(parseVersion('release-0.83.0'), undefined);
});

test('a prerelease does not satisfy the corresponding stable minimum', () => {
  assert.equal(isVersionSupported('0.81.0-rc.1', '0.81.0'), false);
  assert.equal(isVersionSupported('0.81.0+build.7', '0.81.0'), true);
});

test('classifyVersion distinguishes feature support and upgrade advice', () => {
  assert.equal(classifyVersion('0.67.9', '0.68.0'), 'unsupported');
  assert.equal(classifyVersion('0.68.0', '0.68.0'), 'upgrade-recommended');
  assert.equal(classifyVersion('0.83.0', '0.68.0'), 'supported');
  assert.equal(classifyVersion('unknown', '0.68.0'), 'unverifiable');
});
