import { pathToFileURL } from 'node:url';

import { config } from '../config.js';
import { errorToLogFields } from '../core/errors.js';
import { createLogger } from '../core/logger.js';
import { applyMigrations } from '../infrastructure/postgres/migrate.js';

export const runDatabaseMigrations = async (): Promise<void> => {
  const logger = createLogger({ level: config.logLevel, bindings: { component: 'db-migrate' } });
  await applyMigrations(config);
  logger.info({}, 'database migrations complete');
};

const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMainModule) {
  void runDatabaseMigrations().catch((error: unknown) => {
    createLogger({ level: 'error', bindings: { component: 'db-migrate' } }).fatal({ error: errorToLogFields(error) }, 'database migration failed');
    process.exitCode = 1;
  });
}
