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

test('mapChipName: a chip the library lists gets no note, even beyond M4', () => {
  assert.deepEqual(mapChipName('Apple M5 Pro', ['M1', 'M2', 'M3', 'M4', 'M5']), { chip: 'M5' });
});

test('mapChipGeneration: unknown chip maps to the newest known chip below it', () => {
  const m = mapChipGeneration(6, ['M1', 'M2', 'M3', 'M5']);
  assert.equal(m?.chip, 'M5');
  assert.match(m?.note ?? '', /M6.*M5/);
});
