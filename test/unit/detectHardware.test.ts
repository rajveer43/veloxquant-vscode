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

test('detectHardware: recognizes M5 chip', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(
      fakeSysctl({
        'machdep.cpu.brand_string': 'Apple M5',
        'hw.memsize': String(32 * 1024 * 1024 * 1024),
      })
    )
  );
  assert.equal(hw.chip, 'M5');
});

test('detectHardware: unrecognized future chip resolves to undefined rather than an unsound value', async () => {
  const hw = await withPlatform('darwin', () =>
    detectHardware(
      fakeSysctl({
        'machdep.cpu.brand_string': 'Apple M9',
        'hw.memsize': String(32 * 1024 * 1024 * 1024),
      })
    )
  );
  assert.equal(hw.chip, undefined);
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

test('detectHardware: non-darwin platform returns undefined without invoking sysctl', async () => {
  const hw = await withPlatform('win32', () =>
    detectHardware(async () => {
      throw new Error('sysctl should not be called on non-darwin platforms');
    })
  );
  assert.equal(hw.chip, undefined);
  assert.equal(hw.ramGb, undefined);
});
