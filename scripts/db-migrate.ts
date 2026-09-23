import { loadConfig } from '../src/core/config.js';
import { errorToLogFields } from '../src/core/errors.js';
import { createLogger } from '../src/core/logger.js';
import { runMigrationHost } from '../src/hosts/migrate-host.js';

const logger = createLogger({ bindings: { component: 'db-migrate' } });

const run = async (): Promise<void> => {
  const config = loadConfig();
  await runMigrationHost(config);
  logger.info({}, 'database migrations complete');
};

void run().catch((error) => {
  logger.fatal({ error: errorToLogFields(error) }, 'migration failed');
  process.exitCode = 1;
});
