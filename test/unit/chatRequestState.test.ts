import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatRequestCoordinator } from '../../src/sdk/chatRequestState';

test('only one chat request can be active', () => {
  const state = new ChatRequestCoordinator();
  assert.ok(state.begin('first'));
  assert.equal(state.begin('second'), undefined);
  assert.equal(state.isActive('first'), true);
});

test('stop-before-first-token aborts the matching request', () => {
  const state = new ChatRequestCoordinator();
  const request = state.begin('first')!;
  assert.equal(state.abort('first'), true);
  assert.equal(request.controller.signal.aborted, true);
  assert.equal(state.isActive('first'), false);
  assert.equal(state.current?.id, 'first');
  assert.equal(state.finish('first'), true);
  assert.equal(state.current, undefined);
});

test('late completion cannot finish a newer request', () => {
  const state = new ChatRequestCoordinator();
  state.begin('first');
  state.finish('first');
  state.begin('second');
  assert.equal(state.finish('first'), false);
  assert.equal(state.isActive('second'), true);
});

test('a mismatched stop request does not abort the active request', () => {
  const state = new ChatRequestCoordinator();
  const request = state.begin('current')!;
  assert.equal(state.abort('stale'), false);
  assert.equal(request.controller.signal.aborted, false);
});
