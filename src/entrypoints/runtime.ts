import { errorToLogFields } from '../core/errors.js';
import { createLogger } from '../core/logger.js';
import { startBot } from './bot.js';
import { runDatabaseMigrations } from './db-migrate.js';
import { startPortalServer } from '../app-server.js';

type RuntimeRole = 'app' | 'bot' | 'migrate';

const role = process.argv[2] as RuntimeRole | undefined;
const logger = createLogger({ bindings: { component: 'runtime-entrypoint' } });

const run = async (): Promise<void> => {
  if (role === 'app') {
    await startPortalServer();
    return;
  }
  if (role === 'bot') {
    await startBot();
    return;
  }
  if (role === 'migrate') {
    await runDatabaseMigrations();
    return;
  }
  throw new Error('Usage: node dist/entrypoints/runtime.js <app|bot|migrate>');
};

void run().catch((error: unknown) => {
  logger.fatal({ role: role ?? 'missing', error: errorToLogFields(error) }, '[FIX] runtime role failed');
  process.exitCode = 1;
});
