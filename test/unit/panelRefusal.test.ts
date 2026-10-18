import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { PanelApiClient, PanelRefusedError, parsePanelRefusal } from '../../src/server/panelApiClient';

test('parsePanelRefusal maps a 403 error body to a typed error', () => {
  const err = parsePanelRefusal(403, '{"error":"origin"}', '/api/start');
  assert.ok(err instanceof PanelRefusedError);
  assert.equal(err.reason, 'origin');
  assert.match(err.message, /Panel refused the request.*origin check/);
});

test('parsePanelRefusal ignores other failures', () => {
  assert.equal(parsePanelRefusal(500, '{"error":"origin"}', '/api/start'), undefined);
  assert.equal(parsePanelRefusal(403, 'nope', '/api/start'), undefined);
  assert.equal(parsePanelRefusal(403, '{"detail":"x"}', '/api/start'), undefined);
});

test('stop() sends a JSON content type and surfaces a 403 as PanelRefusedError', async () => {
  let contentType: string | undefined;
  const server = http.createServer((req, res) => {
    contentType = req.headers['content-type'];
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end('{"error":"host"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new PanelApiClient((server.address() as AddressInfo).port);
    await assert.rejects(client.stop(), (err: unknown) => err instanceof PanelRefusedError && err.reason === 'host');
    assert.equal(contentType, 'application/json');
  } finally {
    server.close();
  }
});
