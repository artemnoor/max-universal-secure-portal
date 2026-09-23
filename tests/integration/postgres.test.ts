import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPostgresClient } from '../../src/infrastructure/postgres/client.js';
import { applyMigrations } from '../../src/infrastructure/postgres/migrate.js';
import { createPostgresStorage } from '../../src/infrastructure/postgres/repositories.js';
import { createRedisCommands } from '../../src/infrastructure/redis/client.js';
import { RedisEphemeralStore } from '../../src/infrastructure/redis/ephemeral-store.js';

const hasIntegrationDatabase = process.env.RUN_POSTGRES_INTEGRATION === 'true'
  && Boolean(process.env.DATABASE_URL);

test('PostgreSQL migration and ownership smoke test is opt-in', { skip: !hasIntegrationDatabase }, async () => {
  const client = createPostgresClient({
    databaseUrl: process.env.DATABASE_URL,
    isProduction: process.env.NODE_ENV === 'production',
    logLevel: 'warn',
  });
  const principal = { userId: 840001, role: 'user' as const };
  const foreignPrincipal = { userId: 840002, role: 'user' as const };
  const storage = createPostgresStorage(client);
  try {
    const result = await client.query<{ value: number }>('SELECT 1 AS value');
    assert.equal(result.rows[0]?.value, 1);
    await applyMigrations({
      databaseUrl: process.env.DATABASE_URL,
      isProduction: process.env.NODE_ENV === 'production',
      logLevel: 'warn',
    });
    await applyMigrations({
      databaseUrl: process.env.DATABASE_URL,
      isProduction: process.env.NODE_ENV === 'production',
      logLevel: 'warn',
    });
    const applied = await client.query<{ version: string; checksum: string | null }>("SELECT version, checksum FROM schema_migrations WHERE version = '0001_initial'");
    assert.equal(applied.rowCount, 1);
    assert.match(applied.rows[0]?.checksum ?? '', /^[a-f0-9]{64}$/u);

    await storage.users.upsert(principal, { firstName: 'Integration', username: 'integration_user' });
    await storage.users.upsert(foreignPrincipal, { firstName: 'Foreign', username: 'foreign_user' });
    await storage.savedItems.save(principal, 'resource', 'resource-1', 'default');
    assert.deepEqual((await storage.savedItems.list(principal, 'resource')).map((item) => item.itemId), ['resource-1']);
    assert.deepEqual(await storage.savedItems.list(foreignPrincipal, 'resource'), []);

    const first = await storage.updateInbox.reserve('integration-event-1', principal);
    const duplicate = await storage.updateInbox.reserve('integration-event-1', principal);
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    await storage.updateInbox.markProcessed('integration-event-1');
  } finally {
    await client.query('DELETE FROM portal_users WHERE user_id IN ($1, $2)', [principal.userId, foreignPrincipal.userId]);
    await storage.close();
  }
});

const hasIntegrationRedis = process.env.RUN_POSTGRES_INTEGRATION === 'true'
  && Boolean(process.env.REDIS_URL);

test('Redis ephemeral store enforces one-time keys and ownership locks', { skip: !hasIntegrationRedis }, async () => {
  const commands = createRedisCommands({ redisUrl: process.env.REDIS_URL });
  const store = new RedisEphemeralStore(commands, 'integration', 'integration-test-salt');
  try {
    if (commands.ping) assert.equal(await commands.ping(), 'PONG');
    assert.equal(await store.consumeOnce('integration-once-key', 30), true);
    assert.equal(await store.consumeOnce('integration-once-key', 30), false);
    const first = await store.acquireUserLock(840001, 30);
    assert.ok(first);
    assert.equal(await store.acquireUserLock(840001, 30), undefined);
    assert.equal(await store.releaseUserLock(840001, first), true);
  } finally {
    await store.close();
  }
});
