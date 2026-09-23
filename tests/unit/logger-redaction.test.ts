import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLogger, principalHash } from '../../src/core/logger.js';

test('structured logger redacts auth, PII and credential-shaped fields', () => {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    bindings: { component: 'test' },
    sink: (line) => lines.push(line),
  });

  logger.info({
    requestId: 'request-1',
    safeField: 'visible',
    initData: 'raw-init-data-secret',
    phone: '+79990000000',
    authorization: 'Bearer bot-token-secret',
    nested: { raw: 'nested-secret', latitude: 55.75 },
  }, 'request completed');
  logger.error(new Error('initData=auth_date=123&hash=raw-init-data-secret'), 'provider failed');

  assert.equal(lines.length, 2);
  const serialized = lines[0];
  assert.ok(serialized.includes('visible'));
  assert.ok(serialized.includes('[REDACTED]'));
  assert.ok(!serialized.includes('raw-init-data-secret'));
  assert.ok(!serialized.includes('+79990000000'));
  assert.ok(!serialized.includes('bot-token-secret'));
  assert.ok(!serialized.includes('nested-secret'));
  assert.ok(!lines[1].includes('raw-init-data-secret'));
});

test('logger context and audit events stay structured', () => {
  const lines: string[] = [];
  const logger = createLogger({ level: 'info', sink: (line) => lines.push(line) }).withContext({ requestId: 'request-2' });

  logger.audit('profile.read', 'user', 'user-42', { phone: '+79990000000', resultCount: 2 });

  const record = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(record.requestId, 'request-2');
  assert.equal(record.level, 'info');
  assert.equal((record.audit as Record<string, unknown>).action, 'profile.read');
  assert.ok(!lines[0].includes('+79990000000'));
});

test('principal hash is stable but does not expose the numeric user id', () => {
  const first = principalHash(42, 'test-salt');
  const second = principalHash(42, 'test-salt');

  assert.equal(first, second);
  assert.notEqual(first, '42');
  assert.equal(principalHash(42), 'unavailable');
});
