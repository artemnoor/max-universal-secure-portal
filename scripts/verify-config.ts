import assert from 'node:assert/strict';

import { ConfigError } from '../src/core/errors.js';
import { loadConfig, type AppConfig, type NodeEnvironment } from '../src/core/config.js';
import { createPostgresClient } from '../src/infrastructure/postgres/client.js';
import { createRedisCommands } from '../src/infrastructure/redis/client.js';

const baseProductionEnvironment: NodeJS.ProcessEnv = {
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
};

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  return inline?.slice(prefix.length);
};

const positionalMode = process.argv.slice(2).find((value): value is NodeEnvironment =>
  value === 'development' || value === 'staging' || value === 'production',
);
const configuredMode = process.env.npm_config_mode;
const npmMode = configuredMode === 'development' || configuredMode === 'staging' || configuredMode === 'production'
  ? configuredMode
  : undefined;
const mode = (argument('--mode') ?? npmMode ?? positionalMode ?? process.env.NODE_ENV ?? 'development') as NodeEnvironment;
const checkDeps = process.argv.includes('--check-deps');
const failures: string[] = [];
let loadedConfig: AppConfig | undefined;

const check = (name: string, callback: () => void): void => {
  try {
    callback();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    const key = error instanceof ConfigError ? error.key : 'runtime';
    console.log(`[FAIL] ${name} (${key})`);
    failures.push(name);
  }
};

const checkAsync = async (name: string, callback: () => Promise<void>): Promise<void> => {
  try {
    await callback();
    console.log(`[PASS] ${name}`);
  } catch {
    console.log(`[FAIL] ${name} (dependency)`);
    failures.push(name);
  }
};

const run = async (): Promise<void> => {
  check(`configuration invariants (${mode})`, () => {
    loadedConfig = loadConfig({
      ...process.env,
      NODE_ENV: mode,
      ...(process.env.BOT_TOKEN || mode === 'production' ? {} : { BOT_TOKEN: 'fixture-bot-token' }),
    });
  });

  check('polling is rejected in production', () => {
    assert.throws(
      () => loadConfig({ ...baseProductionEnvironment, MAX_TRANSPORT: 'polling' }),
      (error: unknown) => error instanceof ConfigError && error.key === 'MAX_TRANSPORT',
    );
  });

  check('unverified Mini App mode is rejected in production', () => {
    assert.throws(
      () => loadConfig({ ...baseProductionEnvironment, ALLOW_UNVERIFIED_MINIAPP: 'true', DEV_ALLOW_UNVERIFIED_MINIAPP: 'true' }),
      (error: unknown) => error instanceof ConfigError && error.key === 'ALLOW_UNVERIFIED_MINIAPP',
    );
  });

  if (checkDeps && loadedConfig) {
    await checkAsync('PostgreSQL read-only connectivity', async () => {
      const client = createPostgresClient(loadedConfig!);
      try {
        const result = await client.query('SELECT 1');
        if (result.rowCount !== 1) throw new Error('unexpected response');
      } finally {
        await client.close();
      }
    });
    await checkAsync('Redis read-only connectivity', async () => {
      const redis = createRedisCommands(loadedConfig!);
      try {
        if (redis.ping) await redis.ping();
        else await redis.get('portal:health');
      } finally {
        await redis.quit();
      }
    });
  }

  if (failures.length > 0) process.exitCode = 1;
  else console.log('Configuration verification passed.');
};

void run();
