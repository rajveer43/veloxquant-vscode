import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStatusResponse, parseMethodsResponse, methodAvailabilityWarning } from '../../src/server/panelApiClient';

const response = (methods: unknown[]) => ({ default_serve_method: 'kivi', accounting_only: true, methods });
const method = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  family: 'quantization',
  serve_tier: 'native',
  serve_tier_label: 'Native',
  is_servable: true,
  blurb: `${name} method`,
  config_fields: [],
  field_schema: [],
  coverage: 'none',
  coverage_label: 'No estimate',
  paper_deviation: null,
  is_adapted: false,
  unsupported_reason: null,
  docs_url: null,
  ...overrides,
});

test('dependency failures expose the shared cause and restart guidance', () => {
  const reason = "cache construction failed: ModuleNotFoundError: No module named 'scipy'";
  const data = parseMethodsResponse(response(['kivi', 'snapkv'].map((name) => method(name, { is_servable: false, unsupported_reason: reason }))));
  const warning = methodAvailabilityWarning(data)!;
  assert.match(warning, /scipy/);
  assert.match(warning, /restart the panel backend/);
  assert.equal(warning.split(reason).length, 2);
});

test('a partially supported catalog does not show a global failure', () => {
  const data = parseMethodsResponse(response([method('kivi'), method('polar', { is_servable: false })]));
  assert.equal(methodAvailabilityWarning(data), undefined);
});

test('empty catalog is reported as unavailable', () => {
  assert.match(methodAvailabilityWarning(parseMethodsResponse(response([])))!, /No serving methods/);
});

test('malformed discovery payloads fail explicitly', () => {
  for (const value of [null, {}, response([null]), response([{ name: 'kivi' }]), response([method('kivi', { is_servable: 'false' })]), { ...response([]), methods: {} }]) {
    assert.throws(() => parseMethodsResponse(value), /response/i);
  }
});

test('panel status accepts the supervisor ready payload and requires a version for GET status', () => {
  const status = {
    state: 'running',
    pid: 123,
    ready: { model: 'mlx-community/test', method: 'kivi' },
    error: null,
    config: {},
    version: '0.83.0',
  };
  assert.equal(isStatusResponse(status, true), true);
  assert.equal(isStatusResponse({ ...status, version: undefined }, true), false);
  assert.equal(isStatusResponse({ ...status, ready: true }), false);
  assert.equal(isStatusResponse({ ...status, config: [] }), false);
  assert.equal(isStatusResponse({ ...status, version: undefined }), true);
});
