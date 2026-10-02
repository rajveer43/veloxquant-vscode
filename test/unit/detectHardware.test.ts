import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectHardware } from '../../src/hardware/detect';

function fakeSysctl(values: Record<string, string>): (key: string) => Promise<string | undefined> {
  return async (key: string) => values[key];
}

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original });
  }
}

test('detectHardware: recognizes M4 chip and exact RAM step', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(
      fakeSysctl({
        'machdep.cpu.brand_string': 'Apple M4',
        'hw.memsize': String(48 * 1024 * 1024 * 1024),
      })
    )
  );
  assert.equal(hw.chip, 'M4');
  assert.equal(hw.ramGb, 48);
});

test('detectHardware: M5 maps to the nearest known chip (M4) with a visible note', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(
      fakeSysctl({
        'machdep.cpu.brand_string': 'Apple M5',
        'hw.memsize': String(32 * 1024 * 1024 * 1024),
      })
    )
  );
  assert.equal(hw.chip, 'M4');
  assert.match(hw.chipNote ?? '', /M5/);
});

test('detectHardware: a known chip carries no chip note', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(fakeSysctl({ 'machdep.cpu.brand_string': 'Apple M3 Pro', 'hw.memsize': String(18 * 1024 ** 3) }))
  );
  assert.equal(hw.chip, 'M3');
  assert.equal(hw.chipNote, undefined);
});

test('detectHardware: non-Apple brand string yields no chip', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(fakeSysctl({ 'machdep.cpu.brand_string': 'Intel(R) Core(TM) i9', 'hw.memsize': String(16 * 1024 ** 3) }))
  );
  assert.equal(hw.chip, undefined);
});

// Captured from `python -m veloxquant_mlx profile-hardware --json` at 0.92.2.
const PROFILE_FIXTURE = JSON.stringify({
  chip: 'Apple M4',
  chip_generation: 4,
  total_memory_bytes: 25769803776,
  available_memory_bytes: 19069665272,
  mlx_version: '0.32.2',
  macos_version: '26.6.2',
  metal_available: true,
  peak_memory_bandwidth_gbps: 90.0,
  avg_quantize_latency_ms_per_token: null,
});

test('detectHardware: prefers profile-hardware output over sysctl', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(
      async () => {
        throw new Error('sysctl should not be needed');
      },
      async () => PROFILE_FIXTURE
    )
  );
  assert.equal(hw.chip, 'M4');
  assert.equal(hw.ramGb, 24);
});

test('detectHardware: profile-hardware reporting a newer chip maps to M4 with a note', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(fakeSysctl({}), async () => JSON.stringify({ chip: 'Apple M5', chip_generation: 5, total_memory_bytes: 32 * 1024 ** 3 }))
  );
  assert.equal(hw.chip, 'M4');
  assert.ok(hw.chipNote);
  assert.equal(hw.ramGb, 32);
});

test('detectHardware: falls back to sysctl when profile output is unusable or the probe throws', async () => {
  const sysctl = fakeSysctl({ 'machdep.cpu.brand_string': 'Apple M2', 'hw.memsize': String(16 * 1024 ** 3) });
  for (const probe of [async () => 'not json', async () => undefined, async () => '{}', async () => { throw new Error('boom'); }]) {
    const hw = await withPlatform('darwin', () => detectHardware(sysctl, probe));
    assert.equal(hw.chip, 'M2');
    assert.equal(hw.ramGb, 16);
  }
});

test('detectHardware: snaps 192GB Mac Studio RAM to the 192 step', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(
      fakeSysctl({
        'machdep.cpu.brand_string': 'Apple M2 Ultra',
        'hw.memsize': String(192 * 1024 * 1024 * 1024),
      })
    )
  );
  assert.equal(hw.ramGb, 192);
});

test('detectHardware: snaps 512GB Mac Studio RAM correctly instead of clamping to the old 128GB ceiling', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(
      fakeSysctl({
        'machdep.cpu.brand_string': 'Apple M3 Ultra',
        'hw.memsize': String(512 * 1024 * 1024 * 1024),
      })
    )
  );
  assert.equal(hw.ramGb, 512);
});

test('detectHardware: 256GB RAM snaps to the 192 step, not a nonexistent 256 step', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(
      fakeSysctl({
        'machdep.cpu.brand_string': 'Apple M2 Ultra',
        'hw.memsize': String(256 * 1024 * 1024 * 1024),
      })
    )
  );
  assert.equal(hw.ramGb, 192);
});

test('detectHardware: non-darwin platform returns undefined without invoking sysctl', async () => {
  const hw = await withPlatform('win32', () =>
    detectHardware(async () => {
      throw new Error('sysctl should not be called on non-darwin platforms');
    })
  );
  assert.equal(hw.chip, undefined);
  assert.equal(hw.ramGb, undefined);
});
