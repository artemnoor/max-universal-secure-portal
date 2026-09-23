import 'dotenv/config';

import { loadConfig, type AppConfig } from './core/config.js';
import { createLogger } from './core/logger.js';
import { errorToLogFields } from './core/errors.js';

export { loadConfig } from './core/config.js';
export type { AppConfig } from './core/config.js';

let cachedConfig: AppConfig | undefined;

export const getConfig = (): AppConfig => {
  if (cachedConfig) return cachedConfig;

  try {
    cachedConfig = loadConfig();
    createLogger({ level: cachedConfig.logLevel, bindings: { component: 'config' } }).info({
      nodeEnv: cachedConfig.nodeEnv,
      transport: cachedConfig.transport,
      isProduction: cachedConfig.isProduction,
    }, 'configuration loaded');
  } catch (error) {
    createLogger({ level: 'error', bindings: { component: 'config' } }).error({
      error: errorToLogFields(error),
    }, 'configuration rejected');
    throw error;
  }

  return cachedConfig;
};

// Keep existing imports working while avoiding a configuration exception during module import.
export const config = new Proxy({} as AppConfig, {
  get: (_target, property, receiver) => Reflect.get(getConfig(), property, receiver),
  has: (_target, property) => property in getConfig(),
  ownKeys: () => Reflect.ownKeys(getConfig()),
  getOwnPropertyDescriptor: (_target, property) => {
    const descriptor = Object.getOwnPropertyDescriptor(getConfig(), property);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});
