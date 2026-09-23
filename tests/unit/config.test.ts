import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError } from '../../src/core/errors.js';
import { loadConfig } from '../../src/core/config.js';

const production = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production', BOT_TOKEN: 'fixture-token', MAX_TRANSPORT: 'webhook',
  WEBHOOK_DOMAIN: 'bot.example.com', WEBHOOK_SECRET: 'fixture-secret_123',
  DATABASE_URL: 'postgresql://db.example.com/portal', REDIS_URL: 'rediss://redis.example.com:6379',
  PUBLIC_APP_ORIGINS: 'https://portal.example.com', PII_ENCRYPTION_KEY: '00'.repeat(32),
  PORTAL_SECURITY_V2: 'true', PORTAL_STORAGE_V2: 'true', ...overrides,
});
test('test config is safe and frozen', () => { const config = loadConfig({ NODE_ENV: 'test' }); assert.equal(config.transport, 'polling'); assert.equal(config.initDataTtlSeconds, 900); assert.equal(config.portalSecurityV2, true); assert.equal(config.portalStorageV2, true); assert.equal(config.metricsToken, ''); assert.ok(Object.isFrozen(config)); });
test('production requires secure runtime choices', () => { assert.throws(() => loadConfig(production({ MAX_TRANSPORT: 'polling' })), (error: unknown) => error instanceof ConfigError && error.key === 'MAX_TRANSPORT'); assert.throws(() => loadConfig(production({ REDIS_URL: 'redis://redis.example.com' })), (error: unknown) => error instanceof ConfigError && error.key === 'REDIS_URL'); });
test('origins and webhook values are validated', () => { assert.deepEqual(loadConfig(production({ PUBLIC_APP_ORIGINS: 'https://PORTAL.EXAMPLE.COM:443' })).publicAppOrigins, ['https://portal.example.com']); assert.throws(() => loadConfig({ NODE_ENV: 'development', BOT_TOKEN: 'x', MAX_TRANSPORT: 'webhook', WEBHOOK_DOMAIN: 'https://bad.example' }), (error: unknown) => error instanceof ConfigError && error.key === 'WEBHOOK_DOMAIN'); });
