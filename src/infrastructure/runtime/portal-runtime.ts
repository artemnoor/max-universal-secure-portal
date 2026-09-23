import type { AppConfig } from '../../core/config.js';
import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { EphemeralStore } from '../../portal/ports/ephemeral.js';
import type { StoragePort } from '../../portal/ports/storage.js';
import { InMemoryEphemeralStore, RedisEphemeralStore } from '../redis/ephemeral-store.js';
import { createRedisCommands } from '../redis/client.js';
import { createPostgresClient } from '../postgres/client.js';
import { verifyMigrations } from '../postgres/migrate.js';
import { createPostgresStorage } from '../postgres/repositories.js';
import { InMemoryUpdateInbox } from '../memory/update-inbox.js';
import { PostgresPortalStore } from './postgres-portal-store.js';
import { Store } from '../../store.js';
import type { PortalUserStore } from '../../portal/ports/user-store.js';

export type PortalRuntime = Readonly<{ store: PortalUserStore; storage?: StoragePort; ephemeral: EphemeralStore; updateInbox: Pick<StoragePort, 'updateInbox'>; readiness: () => Promise<void>; close(): Promise<void> }>;
export type PortalRuntimeOptions = Readonly<{ moduleMigrations?: readonly Readonly<{ ownerId: string; version: string; sql: string }>[] }>;
export const createPortalRuntime = (config: AppConfig, options: PortalRuntimeOptions = {}): PortalRuntime => {
  if (config.nodeEnv === 'development' || config.nodeEnv === 'test') {
    if (config.databaseUrl || config.redisUrl) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Локальное хранилище требует пустые DATABASE_URL и REDIS_URL.', { details: { storage: 'file', environment: config.nodeEnv } });
    const store = new Store(config.dataDir, { allowFileStore: true });
    const ephemeral = new InMemoryEphemeralStore(); const updateInbox = new InMemoryUpdateInbox();
    return { store, ephemeral, updateInbox: { updateInbox }, readiness: async () => { await store.getStats(); }, async close() { await ephemeral.close(); await store.close(); } };
  }
  const postgres = createPostgresClient(config); const storage = createPostgresStorage(postgres);
  let ephemeral: EphemeralStore; let redis: ReturnType<typeof createRedisCommands>;
  try { redis = createRedisCommands(config); ephemeral = new RedisEphemeralStore(redis, 'portal', config.piiEncryptionKey); }
  catch (error) { void postgres.close(); throw error; }
  const store = new PostgresPortalStore({ storage, adminUserIds: config.adminUserIds, stats: async () => { const result = await postgres.query<{ count: string | number }>('SELECT COUNT(*)::int AS count FROM portal_users'); return { users: Number(result.rows[0]?.count ?? 0) }; } });
  return { store, storage, ephemeral, updateInbox: storage, readiness: async () => { await postgres.query('SELECT 1'); await verifyMigrations(postgres, undefined, options.moduleMigrations); if (redis.ping) await redis.ping(); }, async close() { await ephemeral.close(); await store.close(); } };
};
