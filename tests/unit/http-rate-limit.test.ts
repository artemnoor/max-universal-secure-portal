import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../src/core/errors.js';
import { createHttpRateLimiter } from '../../src/http/rate-limit.js';
import { InMemoryEphemeralStore } from '../../src/infrastructure/redis/ephemeral-store.js';
import { PortalMetrics } from '../../src/observability/metrics.js';

test('HTTP rate limiter bounds each scope and does not expose raw identifiers in keys', async () => {
  const store = new InMemoryEphemeralStore();
  const metrics = new PortalMetrics();
  const limiter = createHttpRateLimiter(store, { maxRequests: 2, windowSeconds: 60, salt: 'fixture-salt', metrics });
  await limiter('ip', '127.0.0.1');
  await limiter('ip', '127.0.0.1');
  await assert.rejects(() => limiter('ip', '127.0.0.1'), (error: unknown) => error instanceof AppError && error.code === 'RATE_LIMITED');
  await assert.doesNotReject(() => limiter('principal', '42'));
  assert.equal(await store.get('http:ip:127.0.0.1'), undefined);
  assert.equal(metrics.snapshot()['rate_limits_total{status=rejected}'], 1);
  await store.close();
});

test('HTTP rate limiter rejects unsafe scope values and configuration', async () => {
  const store = new InMemoryEphemeralStore();
  assert.throws(() => createHttpRateLimiter(store, { maxRequests: 0 }), { code: 'CONFIG_INVALID' });
  const limiter = createHttpRateLimiter(store);
  await assert.rejects(() => limiter('ip', 'raw initData with spaces'), { code: 'VALIDATION_FAILED' });
  await store.close();
});
