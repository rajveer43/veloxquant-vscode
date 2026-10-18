import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBandwidth, parseBandwidthMeasurement } from '../../src/hardware/measureBandwidth';

const profile = (extra: Record<string, unknown>) =>
  JSON.stringify({ chip: 'Apple M4', chip_generation: 4, total_memory_bytes: 17179869184, peak_memory_bandwidth_gbps: 120, ...extra });

test('parseBandwidthMeasurement: numeric bandwidth when the flag succeeded', () => {
  assert.deepEqual(parseBandwidthMeasurement(profile({ measured_bandwidth_gbps: 98.4 })), { measuredGbps: 98.4, nominalGbps: 120 });
});

test('parseBandwidthMeasurement: undefined when absent, null or unparsable', () => {
  assert.equal(parseBandwidthMeasurement(profile({})), undefined);
  assert.equal(parseBandwidthMeasurement(profile({ measured_bandwidth_gbps: null })), undefined);
  assert.equal(parseBandwidthMeasurement('nope'), undefined);
});

test('formatBandwidth: includes nominal peak when known', () => {
  assert.equal(formatBandwidth({ measuredGbps: 98.44, nominalGbps: 120 }), '98.4 GB/s (nominal peak 120 GB/s)');
  assert.equal(formatBandwidth({ measuredGbps: 98.44 }), '98.4 GB/s');
});
