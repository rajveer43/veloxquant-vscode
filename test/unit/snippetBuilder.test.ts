import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pythonRepr, buildKVCacheConfigSnippet, buildFullSnippet } from '../../src/insert/snippetBuilder';

test('pythonRepr: integers render bare', () => {
  assert.equal(pythonRepr(1), '1');
  assert.equal(pythonRepr(42), '42');
  assert.equal(pythonRepr(0), '0');
  assert.equal(pythonRepr(-3), '-3');
});

test('pythonRepr: floats render bare', () => {
  assert.equal(pythonRepr(7.5), '7.5');
  assert.equal(pythonRepr(0.1), '0.1');
});

test('pythonRepr: strings render single-quoted', () => {
  assert.equal(pythonRepr('turboquant_rvq'), "'turboquant_rvq'");
});

test('pythonRepr: strings with embedded quotes/backslashes are escaped', () => {
  assert.equal(pythonRepr("it's"), "'it\\'s'");
  assert.equal(pythonRepr('back\\slash'), "'back\\\\slash'");
});

test('pythonRepr: booleans render as Python True/False', () => {
  assert.equal(pythonRepr(true), 'True');
  assert.equal(pythonRepr(false), 'False');
});

test('pythonRepr: non-finite numbers throw rather than emit invalid Python', () => {
  assert.throws(() => pythonRepr(Number.POSITIVE_INFINITY));
  assert.throws(() => pythonRepr(Number.NaN));
});

test('buildKVCacheConfigSnippet: empty knobs object produces just method=', () => {
  const snippet = buildKVCacheConfigSnippet('h2o', {});
  assert.equal(snippet, "KVCacheConfig(method='h2o')");
});

test('buildKVCacheConfigSnippet: mixed knob types, no trailing comma', () => {
  const snippet = buildKVCacheConfigSnippet('turboquant_rvq', {
    bit_width_inlier: 1,
    seed: 42,
  });
  assert.equal(snippet, "KVCacheConfig(method='turboquant_rvq', bit_width_inlier=1, seed=42)");
  assert.ok(!snippet.includes(',)'));
});

test('buildKVCacheConfigSnippet: string, float, and bool knobs together', () => {
  const snippet = buildKVCacheConfigSnippet('kivi_sink', {
    kivi_group_size: 64,
    ratio: 0.5,
    use_sink: true,
    label: 'default',
  });
  assert.equal(
    snippet,
    "KVCacheConfig(method='kivi_sink', kivi_group_size=64, ratio=0.5, use_sink=True, label='default')"
  );
});

test('buildFullSnippet: produces valid-looking multi-line Python with imports and builder call', () => {
  const snippet = buildFullSnippet('turboquant_rvq', { bit_width_inlier: 1, seed: 42 });
  assert.match(snippet, /^from veloxquant_mlx import KVCacheBuilder, KVCacheConfig/);
  assert.match(snippet, /config = KVCacheConfig\(method='turboquant_rvq', bit_width_inlier=1, seed=42\)/);
  assert.match(snippet, /caches = KVCacheBuilder\.for_model\(model, config\)/);
});
