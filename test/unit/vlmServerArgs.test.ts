import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVlmServeArgv, isMlxVlmMissing } from '../../src/server/vlmServerArgs';

test('buildVlmServeArgv binds loopback and forwards model/port', () => {
  assert.deepEqual(buildVlmServeArgv({ model: 'org/vlm', port: 8080 }), [
    '-m', 'veloxquant_mlx', 'vlm-serve', '--host', '127.0.0.1', '--port', '8080', '--model', 'org/vlm',
  ]);
});

test('buildVlmServeArgv passes method and bits first', () => {
  const argv = buildVlmServeArgv({ model: 'm', port: 9000, method: 'kivi', bits: 4 });
  assert.deepEqual(argv.slice(3, 7), ['--method', 'kivi', '--bits', '4']);
});

test('isMlxVlmMissing matches the library error', () => {
  assert.ok(isMlxVlmMissing("error: vlm-serve requires mlx-vlm. Install it with 'uv sync --extra vlm'"));
  assert.ok(!isMlxVlmMissing('some other failure'));
});
