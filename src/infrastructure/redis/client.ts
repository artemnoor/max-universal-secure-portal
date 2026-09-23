import { createRequire } from 'node:module';

import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { AppConfig } from '../../core/config.js';
import { InMemoryEphemeralStore, RedisEphemeralStore, type RedisCommands } from './ephemeral-store.js';
import type { EphemeralStore } from '../../portal/ports/ephemeral.js';

type RedisLike = RedisCommands & Readonly<{ ping?(): Promise<string> }>;
type RedisConstructor = new (url: string, options?: Record<string, unknown>) => RedisLike;
const require = createRequire(import.meta.url);

const dependencyError = (reason: string, cause?: unknown): AppError => new AppError(
  ERROR_CODES.DEPENDENCY_UNAVAILABLE,
  503,
  'Временное хранилище недоступно.',
  { cause, details: { dependency: 'redis', reason } },
);

export const createRedisCommands = (config: Pick<AppConfig, 'redisUrl'>): RedisCommands => {
  if (!config.redisUrl) throw dependencyError('REDIS_URL is not configured');
  try {
    const module = require('ioredis') as { default?: RedisConstructor } | RedisConstructor;
    const Redis = typeof module === 'function' ? module : module.default;
    if (!Redis) throw new Error('ioredis constructor is unavailable');
    return new Redis(config.redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      connectTimeout: 5_000,
      commandTimeout: 5_000,
    });
  } catch (error) {
    throw dependencyError('ioredis package is not installed', error);
  }
};

export const createEphemeralStore = (
  config: Pick<AppConfig, 'nodeEnv' | 'isProduction'> & Partial<Pick<AppConfig, 'redisUrl' | 'piiEncryptionKey'>>,
): EphemeralStore => {
  if (config.nodeEnv === 'development' || config.nodeEnv === 'test') return new InMemoryEphemeralStore();
  if (!config.piiEncryptionKey) {
    throw new AppError(
      ERROR_CODES.CONFIG_INVALID,
      500,
      'Production ephemeral store requires PII_ENCRYPTION_KEY.',
      { details: { key: 'PII_ENCRYPTION_KEY' } },
    );
  }
  if (!config.redisUrl) throw dependencyError('REDIS_URL is not configured');
  const commands = createRedisCommands({ redisUrl: config.redisUrl });
  return new RedisEphemeralStore(commands, 'portal', config.piiEncryptionKey);
};
