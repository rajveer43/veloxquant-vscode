import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVeloxQuantOptions } from '../../src/sdk/client';

test('getVeloxQuantOptions: maps a resolved interpreter path into pythonPath', async () => {
  const options = await getVeloxQuantOptions(async () => ({ path: '/usr/bin/python3', source: 'setting' }));
  assert.deepEqual(options, { pythonPath: '/usr/bin/python3' });
});

test('getVeloxQuantOptions: no resolved interpreter yields an empty options bag', async () => {
  const options = await getVeloxQuantOptions(async () => ({ path: undefined, source: 'none' }));
  assert.deepEqual(options, {});
});
