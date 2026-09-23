import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError, ERROR_CODES } from '../../src/core/errors.js';
import { createEphemeralStore } from '../../src/infrastructure/redis/client.js';

test('production ephemeral store fails closed without Redis', () => {
  assert.throws(
    () => createEphemeralStore({ nodeEnv: 'production', isProduction: true, piiEncryptionKey: 'fixture-key' }),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.DEPENDENCY_UNAVAILABLE,
  );
});

test('production ephemeral store fails closed without a namespace secret', () => {
  assert.throws(
    () => createEphemeralStore({ nodeEnv: 'production', isProduction: true, redisUrl: 'redis://127.0.0.1:16379' }),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.CONFIG_INVALID,
  );
});

test('development ephemeral store uses an explicit in-memory adapter', async () => {
  const store = createEphemeralStore({ nodeEnv: 'development', isProduction: false });
  assert.equal(await store.consumeOnce('fixture', 60), true);
  await store.close();
});
