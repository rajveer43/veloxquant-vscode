import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASURE_BANDWIDTH_ARGV, PROFILE_HARDWARE_ARGV, parseProfileHardware } from '../../src/hardware/profileHardware';

test('argv: measuring bandwidth only appends the flag', () => {
  assert.deepEqual(MEASURE_BANDWIDTH_ARGV, [...PROFILE_HARDWARE_ARGV, '--measure-bandwidth']);
});

test('parses a full profile-hardware payload', () => {
  const profile = parseProfileHardware(JSON.stringify({
    chip_generation: 4,
    total_memory_bytes: 34359738368,
    metal_available: true,
    peak_memory_bandwidth_gbps: 120,
    measured_bandwidth_gbps: 101.5,
  }));
  assert.equal(profile?.chip?.chip, 'M4');
  assert.equal(profile?.totalMemoryBytes, 34359738368);
  assert.equal(profile?.metalAvailable, true);
  assert.equal(profile?.peakMemoryBandwidthGbps, 120);
  assert.equal(profile?.measuredBandwidthGbps, 101.5);
});

test('falls back to the chip name when the generation is absent', () => {
  const profile = parseProfileHardware(JSON.stringify({ chip: 'Apple M2 Pro', total_memory_bytes: 17179869184 }));
  assert.equal(profile?.chip?.chip, 'M2');
});

test('unusable output yields undefined', () => {
  for (const out of ['', 'not json', '[]', 'null', '{}', '{"metal_available":true}']) {
    assert.equal(parseProfileHardware(out), undefined, out);
  }
});

test('non-positive or non-numeric numbers are dropped, not propagated', () => {
  const profile = parseProfileHardware(JSON.stringify({
    total_memory_bytes: 8589934592,
    peak_memory_bandwidth_gbps: -1,
    measured_bandwidth_gbps: '100',
    metal_available: 'yes',
  }));
  assert.equal(profile?.peakMemoryBandwidthGbps, undefined);
  assert.equal(profile?.measuredBandwidthGbps, undefined);
  assert.equal(profile?.metalAvailable, undefined);
});

test('a chip newer than the known list is mapped to the supplied library list', () => {
  const profile = parseProfileHardware(JSON.stringify({ chip_generation: 5 }), ['M1', 'M2', 'M3', 'M4', 'M5']);
  assert.equal(profile?.chip?.chip, 'M5');
});
