import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigError } from '../../src/core/errors.js';
import { loadConfig } from '../../src/core/config.js';

const secureProductionEnvironment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  BOT_TOKEN: 'fixture-bot-token',
  MAX_TRANSPORT: 'webhook',
  WEBHOOK_DOMAIN: 'bot.example.com',
  WEBHOOK_SECRET: 'fixture-secret_123',
  DATABASE_URL: 'postgresql://db.example.com/portal',
  REDIS_URL: 'rediss://redis.example.com:6379',
  PUBLIC_APP_ORIGINS: 'https://portal.example.com',
  PII_ENCRYPTION_KEY: '00'.repeat(32),
  PORTAL_SECURITY_V2: 'true',
  PORTAL_STORAGE_V2: 'true',
  ...overrides,
});

test('rollout preflight fails closed without secure release gates and does not mutate input', () => {
  const environment = secureProductionEnvironment({ PORTAL_SECURITY_V2: 'false' });
  const before = JSON.stringify(environment);

  assert.throws(
    () => loadConfig(environment),
    (error: unknown) => error instanceof ConfigError && error.key === 'PORTAL_SECURITY_V2',
  );
  assert.equal(JSON.stringify(environment), before);
});

test('rollout preflight accepts only explicit secure gates and leaves AI disabled by default', () => {
  const config = loadConfig(secureProductionEnvironment());
  assert.equal(config.portalSecurityV2, true);
  assert.equal(config.portalStorageV2, true);
  assert.equal(config.portalAiEnabled, false);
  assert.equal(config.allowUnverifiedMiniApp, false);
});
