import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../src/store.js';
import { buildHttpApp } from '../../src/http/app.js';

const config = { nodeEnv: 'test' as const, isProduction: false, botToken: '', initDataTtlSeconds: 900, allowUnverifiedMiniApp: false, devAllowUnverifiedMiniApp: false, adminUserIds: [] as readonly number[], publicAppOrigins: ['http://allowed.example'] as readonly string[], webhookPath: '/max/webhook', webhookSecret: '' };
test('HTTP boundary serves health and rejects query auth/origin violations', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'max-portal-http-')); const store = new Store(dir, { allowFileStore: true }); const app = buildHttpApp({ config, store }); const server = createServer((request, response) => { void app.handler(request, response); }); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('not bound'); const base = 'http://127.0.0.1:' + address.port;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await rm(dir, { recursive: true, force: true }); });
  const health = await fetch(base + '/api/v1/health'); assert.equal(health.status, 200); assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  const query = await fetch(base + '/api/v1/health?initData=secret'); assert.equal(query.status, 400);
  const wrongOrigin = await fetch(base + '/api/v1/health', { headers: { origin: 'https://evil.example' } }); assert.equal(wrongOrigin.status, 403);
});
