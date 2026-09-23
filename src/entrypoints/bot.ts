import { config } from '../config.js';
import { errorToLogFields } from '../core/errors.js';
import { createLogger } from '../core/logger.js';
import { createPortalComposition } from './composition.js';
import { createBotHost } from '../hosts/bot-host.js';

/** Empty composition root: product modules are supplied through createPortalComposition options. */
export const startBot = async (): Promise<void> => {
  const logger = createLogger({ level: config.logLevel, bindings: { component: 'max-bot-entrypoint' } });
  const composition = createPortalComposition(config, { logger });
  const host = createBotHost(composition);
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'bot shutdown started');
    try {
      await host.stop();
      logger.info({ signal }, 'bot shutdown completed');
    } catch (error) {
      logger.error({ signal, error: errorToLogFields(error) }, 'bot shutdown failed');
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  try {
    await host.start();
  } catch (error) {
    logger.fatal({ error: errorToLogFields(error) }, 'failed to start MAX bot host');
    await host.stop().catch((closeError: unknown) => logger.error({ error: errorToLogFields(closeError) }, 'failed to close bot host'));
    process.exitCode = 1;
    throw error;
  }
};
