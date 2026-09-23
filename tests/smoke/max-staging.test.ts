import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ALLOWED_UPDATES } from '../../src/platform/max/create-max-bot.js';
import { runSmoke } from '../../scripts/smoke-max.js';

const environment: NodeJS.ProcessEnv = { SMOKE_BASE_URL: 'https://staging.example.com', SMOKE_BOT_TOKEN: 'fixture-bot-token', SMOKE_USER_ID: '840001', SMOKE_ALLOW_MUTATION: 'true', SMOKE_MAX_API_BASE_URL: 'https://max-api.example.com', SMOKE_WEBHOOK_URL: 'https://staging.example.com/max/webhook' };
test('MAX staging smoke verifies health and subscription without secrets in URLs', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init }); const parsed = new URL(url);
    if (parsed.origin === 'https://staging.example.com' && ['/health/live', '/health/ready'].includes(parsed.pathname)) return new Response('{}', { status: 200 });
    if (parsed.origin === 'https://staging.example.com' && parsed.pathname === '/api/v1/health') return new Response('{}', { status: parsed.search ? 400 : 200 });
    if (parsed.origin === 'https://staging.example.com' && parsed.pathname === '/api/v1/extension-placeholder') return new Response('{}', { status: 404 });
    if (parsed.origin === 'https://max-api.example.com' && parsed.pathname === '/me') return new Response('{}', { status: 200 });
    if (parsed.origin === 'https://max-api.example.com' && parsed.pathname === '/subscriptions') return new Response(JSON.stringify({ subscriptions: [{ url: environment.SMOKE_WEBHOOK_URL, update_types: DEFAULT_ALLOWED_UPDATES }] }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  await runSmoke(environment, fetcher);
  assert.ok(calls.some(({ url }) => url === 'https://staging.example.com/health/live'));
  assert.ok(calls.some(({ url }) => url === 'https://max-api.example.com/subscriptions'));
  assert.ok(calls.every(({ url }) => !url.includes('fixture-bot-token')));
  const maxCall = calls.find(({ url }) => url.endsWith('/me')); assert.equal(new Headers(maxCall?.init?.headers).get('authorization'), 'fixture-bot-token');
});
test('MAX smoke rejects unsafe origins and API endpoints before requests', async () => {
  await assert.rejects(runSmoke({ ...environment, SMOKE_BASE_URL: 'http://staging.example.com' }, fetch), /SMOKE_BASE_URL must be a clean HTTPS origin/);
  await assert.rejects(runSmoke({ ...environment, SMOKE_MAX_API_BASE_URL: 'http://max-api.example.com' }, fetch), /SMOKE_MAX_API_BASE_URL must use HTTPS/);
});
