import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMethodsArgv, parseMethods, MethodsError } from '../../src/python/methodsClient';
import { discoverServableMethods } from '../../src/sdk/methods';
import { isVersionSupported } from '../../src/python/versionCheck';

const entry = (name: string, overrides: Record<string, unknown> = {}) => ({
  name, family: 'quantization', serve_tier: 'accounting_only', serve_tier_label: 'Accounting only', maturity: 'stable',
  is_servable: true, blurb: 'b', config_fields: ['bits'],
  field_schema: [{ name: 'bits', type: 'int', default: 4, optional: false, help: null }],
  coverage: 'keys_only', coverage_label: 'Keys only', paper_deviation: null, is_adapted: false,
  unsupported_reason: null, docs_url: null, capabilities: {}, ...overrides,
});
const payload = (methods: unknown[], overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ schema_version: 1, default_serve_method: 'kivi', accounting_only: true, methods, ...overrides });

test('buildMethodsArgv: flags only when requested', () => {
  assert.deepEqual(buildMethodsArgv(), ['-m', 'veloxquant_mlx', 'methods', '--json']);
  assert.deepEqual(buildMethodsArgv({ servableOnly: true, family: 'eviction' }),
    ['-m', 'veloxquant_mlx', 'methods', '--json', '--servable-only', '--family', 'eviction']);
});

test('parseMethods: exposes maturity and field_schema for every entry', () => {
  const r = parseMethods(payload([entry('kivi'), entry('h2o', { maturity: 'beta' })]));
  assert.equal(r.methods.length, 2);
  assert.deepEqual(r.methods.map((m) => m.maturity), ['stable', 'beta']);
  assert.equal(r.methods[0].fieldSchema[0].name, 'bits');
});

test('parseMethods: rejects wrong schema_version, missing maturity and bad JSON', () => {
  assert.throws(() => parseMethods(payload([], { schema_version: 2 })), (e) => e instanceof MethodsError && e.kind === 'parse-failed');
  assert.throws(() => parseMethods(payload([entry('x', { maturity: undefined })])), { kind: 'parse-failed' });
  assert.throws(() => parseMethods(payload([entry('x', { maturity: 'gold' })])), { kind: 'parse-failed' });
  assert.throws(() => parseMethods('nope'), { kind: 'parse-failed' });
});

const sdkMethod = { name: 'sdk', family: 'f', isServable: true, serveTierLabel: '', telemetryCoverage: null, isAdapted: false, blurb: '' };
const cliMethods = () => parseMethods(payload([entry('kivi'), entry('no', { is_servable: false })])).methods;
const deps = (version: string | undefined, cliFails = false) => ({
  interpreterPath: async () => '/py',
  installedVersion: async () => version,
  cli: async () => { if (cliFails) throw new Error('boom'); return cliMethods(); },
  sdk: async () => [sdkMethod],
});

test('discoverServableMethods: uses the CLI on a current install', async () => {
  const r = await discoverServableMethods(deps('0.94.10'), '0.93.0', isVersionSupported);
  assert.deepEqual(r.map((m) => [m.name, m.maturity]), [['kivi', 'stable']]);
});

test('discoverServableMethods: falls back to the SDK on old installs or CLI failure', async () => {
  assert.equal((await discoverServableMethods(deps('0.91.0'), '0.93.0', isVersionSupported))[0].name, 'sdk');
  assert.equal((await discoverServableMethods(deps('0.94.10', true), '0.93.0', isVersionSupported))[0].name, 'sdk');
});
