import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVersionSupported, MIN_SUPPORTED_VERSION } from '../../src/python/versionCheck';

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
