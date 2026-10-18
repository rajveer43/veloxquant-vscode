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

async function withServer<T>(body: string, run: (client: PanelApiClient) => Promise<T>): Promise<T> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(new PanelApiClient((server.address() as AddressInfo).port));
  } finally {
    server.close();
  }
}

test('getStatus rejects a foreign process answering on the port', async () => {
  await withServer('{"hello":"world"}', async (client) => {
    await assert.rejects(client.getStatus(), /does not look like a VeloxQuant-MLX panel/);
  });
});

test('getStatus accepts a versioned panel status', async () => {
  const body = JSON.stringify({ state: 'stopped', pid: null, ready: null, error: null, config: {}, version: '0.94.10' });
  await withServer(body, async (client) => {
    assert.equal((await client.getStatus()).version, '0.94.10');
  });
});

test('getModels rejects entries with the wrong field types', async () => {
  await withServer('{"models":[{"repo_id":1}]}', async (client) => {
    await assert.rejects(client.getModels());
  });
});
