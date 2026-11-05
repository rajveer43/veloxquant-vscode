import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVlmServeArgv, isMlxVlmMissing, isVlmUnhashableCrash } from '../../src/server/vlmServerArgs';

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

test('isVlmUnhashableCrash matches the pre-0.95.0 WeakSet crash, even when output is truncated', () => {
  const trace = '  File ".../veloxquant_mlx/cli/vlm_serve.py", line 77, in _patch\nTypeError: unhashable type: \'Model\'';
  assert.ok(isVlmUnhashableCrash(trace));
  assert.ok(isVlmUnhashableCrash(trace.slice(-120) + ' vlm-serve'));
});

test('isVlmUnhashableCrash ignores unrelated failures', () => {
  assert.ok(!isVlmUnhashableCrash('TypeError: unhashable type: list'));
  assert.ok(!isVlmUnhashableCrash('vlm-serve requires mlx-vlm'));
});
