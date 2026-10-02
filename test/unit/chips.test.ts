import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapChipName, mapChipGeneration } from '../../src/hardware/chips';

test('mapChipName: known chips pass through without a note', () => {
  assert.deepEqual(mapChipName('Apple M2 Ultra'), { chip: 'M2' });
});

test('mapChipName: newer chips map to M4 with a note', () => {
  const m = mapChipName('Apple M5 Max');
  assert.equal(m?.chip, 'M4');
  assert.match(m?.note ?? '', /M5/);
});

test('mapChipName / mapChipGeneration: garbage yields undefined', () => {
  assert.equal(mapChipName('Intel Core'), undefined);
  assert.equal(mapChipGeneration(0), undefined);
  assert.equal(mapChipGeneration(2.5), undefined);
});
