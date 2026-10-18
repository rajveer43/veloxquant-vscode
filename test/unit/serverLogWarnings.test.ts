import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQFiltersLowRetentionWarning } from '../../src/server/serverLogWarnings';

test('recognises the QFilters low-retention warning as the library prints it', () => {
  const line = '/x/qfilters_cache.py:501: UserWarning: QFiltersKVCache: retention dropped to 40.0% (400/1000 tokens kept), below qfilters_min_retention=90.0%.';
  assert.equal(isQFiltersLowRetentionWarning(line), true);
});

test('ignores unrelated log lines', () => {
  assert.equal(isQFiltersLowRetentionWarning('QFiltersKVCache: initialised with budget 512'), false);
  assert.equal(isQFiltersLowRetentionWarning('retention dropped to 10%'), false);
});
