import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryEphemeralStore } from '../../src/infrastructure/redis/ephemeral-store.js';
import { DeepLinkTokenService } from '../../src/platform/max/deep-link-tokens.js';

test('deep-link tokens are signed, opaque, scoped and one-time', async () => {
  let now = 1_000;
  const service = new DeepLinkTokenService({
    key: '0123456789abcdef0123456789abcdef',
    store: new InMemoryEphemeralStore(),
    now: () => now,
  });
  const token = await service.issue({
    purpose: 'miniapp_start',
    module: 'module',
    principal: { userId: 42, role: 'user' },
    target: { type: 'resource', id: 'resource-1', section: 'summary' },
  });
  assert.ok(token.length <= 512);
  assert.equal(token.includes('secret-phone'), false);
  assert.deepEqual(await service.consume(token, { userId: 42, role: 'user' }, 'miniapp_start'), { type: 'resource', id: 'resource-1', section: 'summary' });
  await assert.rejects(() => service.consume(token, { userId: 42, role: 'user' }, 'miniapp_start'), { code: 'AUTH_INVALID' });
});

test('deep-link tokens reject tampering, wrong purpose, foreign users and expiry', async () => {
  let now = 2_000;
  const service = new DeepLinkTokenService({
    key: '0123456789abcdef0123456789abcdef',
    store: new InMemoryEphemeralStore(),
    now: () => now,
  });
  const token = await service.issue({ purpose: 'bot_start', module: 'module', principal: { userId: 42, role: 'user' }, target: { type: 'root' }, ttlSeconds: 10 });
  const [payload, signature] = token.split('.');
  const tampered = `${payload}.${signature.startsWith('A') ? `B${signature.slice(1)}` : `A${signature.slice(1)}`}`;
  await assert.rejects(() => service.consume(tampered, { userId: 42, role: 'user' }, 'bot_start'), { code: 'AUTH_INVALID' });
  await assert.rejects(() => service.consume(token, { userId: 42, role: 'user' }, 'miniapp_start'), { code: 'AUTH_EXPIRED' });
  await assert.rejects(() => service.consume(token, { userId: 43, role: 'user' }, 'bot_start'), { code: 'FORBIDDEN' });
  now += 11;
  await assert.rejects(() => service.consume(token, { userId: 42, role: 'user' }, 'bot_start'), { code: 'AUTH_EXPIRED' });
});
