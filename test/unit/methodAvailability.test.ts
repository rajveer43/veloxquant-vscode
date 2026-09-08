import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMethodsResponse, methodAvailabilityWarning } from '../../src/server/panelApiClient';

const response = (methods: unknown[]) => ({ default_serve_method: 'kivi', accounting_only: true, methods });

test('dependency failures expose the shared cause and restart guidance', () => {
  const reason = "cache construction failed: ModuleNotFoundError: No module named 'scipy'";
  const data = parseMethodsResponse(response(['kivi', 'snapkv'].map((name) => ({ name, is_servable: false, unsupported_reason: reason }))));
  const warning = methodAvailabilityWarning(data)!;
  assert.match(warning, /scipy/);
  assert.match(warning, /restart the panel backend/);
  assert.equal(warning.split(reason).length, 2);
});

test('a partially supported catalog does not show a global failure', () => {
  const data = parseMethodsResponse(response([{ name: 'kivi', is_servable: true }, { name: 'polar', is_servable: false }]));
  assert.equal(methodAvailabilityWarning(data), undefined);
});

test('empty catalog is reported as unavailable', () => {
  assert.match(methodAvailabilityWarning(parseMethodsResponse(response([])))!, /No serving methods/);
});

test('malformed discovery payloads fail explicitly', () => {
  for (const value of [null, {}, response([null]), response([{ name: 'kivi' }]), response([{ name: 'kivi', is_servable: 'false' }]), { ...response([]), methods: {} }]) {
    assert.throws(() => parseMethodsResponse(value), /response/i);
  }
});
