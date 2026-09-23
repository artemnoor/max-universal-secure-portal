import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../src/core/errors.js';
import { PortalMetrics } from '../../src/observability/metrics.js';
import { createMaxApiFetch, MAX_API_RESPONSE_BYTES, MaxApiClient } from '../../src/platform/max/max-api-client.js';
import { MaxOutboundRateLimiter } from '../../src/platform/max/rate-limiter.js';

test('MAX outbound limiter keeps the safety ceiling and resets its window', async () => {
  let now = 1_000;
  const limiter = new MaxOutboundRateLimiter({ maxRequests: 2, windowSeconds: 1, now: () => now });
  await limiter.acquire();
  await limiter.acquire();
  await assert.rejects(() => limiter.acquire(), { code: 'RATE_LIMITED' });
  now += 1_000;
  await assert.doesNotReject(() => limiter.acquire());
  assert.throws(() => new MaxOutboundRateLimiter({ maxRequests: 26 }), { code: 'CONFIG_INVALID' });
});

test('MAX API client retries only safe transient idempotent operations', async () => {
  let calls = 0;
  const client = new MaxApiClient({ sleep: async () => undefined, random: () => 0 });
  const result = await client.request<string>({
    operation: 'resource.read',
    idempotent: true,
    maxAttempts: 3,
    run: async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('busy'), { status: 503 });
      return 'ok';
    },
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);

  await assert.rejects(
    () => client.request({ operation: 'message.send', maxAttempts: 2, run: async () => 'unsafe' }),
    (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_FAILED',
  );

  const bounded = new MaxApiClient({ limiter: new MaxOutboundRateLimiter({ maxRequests: 1 }) });
  await bounded.request({ operation: 'resource.read', idempotent: true, run: async () => 'first' });
  await assert.rejects(
    () => bounded.request({ operation: 'resource.read', idempotent: true, run: async () => 'second' }),
    (error: unknown) => error instanceof AppError && error.code === 'RATE_LIMITED',
  );
});

test('MAX SDK fetch boundary applies retries only to idempotent requests', async () => {
  let calls = 0;
  const metrics = new PortalMetrics();
  const client = new MaxApiClient({ sleep: async () => undefined, random: () => 0, metrics });
  const fetcher = createMaxApiFetch(client, async (_input, init) => {
    assert.ok(init?.signal);
    calls += 1;
    return calls === 1 || init?.method === 'POST'
      ? new Response(null, { status: calls === 1 ? 429 : 503 })
      : new Response('{}', { status: 200 });
  });

  const read = await fetcher('https://platform-api2.max.ru/me', { method: 'GET' });
  assert.equal(read.status, 200);
  assert.equal(calls, 2);

  await assert.rejects(
    () => fetcher('https://platform-api2.max.ru/subscriptions', { method: 'POST' }),
    (error: unknown) => error instanceof AppError && error.code === 'DEPENDENCY_UNAVAILABLE',
  );
  assert.equal(calls, 3);
  const snapshot = metrics.snapshot();
  assert.equal(snapshot['max_api_requests_total{operation=max.GET._me}'], 2);
  assert.equal(snapshot['max_api_429_total{operation=max.GET._me}'], 1);
  assert.equal(snapshot['max_api_latency_ms{operation=max.GET._me}_count'], 2);
});

test('MAX SDK fetch boundary honors bounded Retry-After and response size limits', async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const client = new MaxApiClient({
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    random: () => 0,
  });
  const fetcher = createMaxApiFetch(client, async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { status: 429, headers: { 'retry-after': '60' } })
      : new Response('{}', { status: 200 });
  });

  await fetcher('https://platform-api2.max.ru/me', { method: 'GET' });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2_000]);

  const oversized = createMaxApiFetch(new MaxApiClient({ sleep: async () => undefined }), async () => new Response('{}', {
    status: 200,
    headers: { 'content-length': String(MAX_API_RESPONSE_BYTES + 1) },
  }));
  await assert.rejects(
    () => oversized('https://platform-api2.max.ru/me', { method: 'GET' }),
    (error: unknown) => error instanceof AppError && error.code === 'DEPENDENCY_UNAVAILABLE',
  );
});
