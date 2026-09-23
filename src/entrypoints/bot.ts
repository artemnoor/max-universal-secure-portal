import { config } from '../config.js';
import { errorToLogFields } from '../core/errors.js';
import { createLogger } from '../core/logger.js';
import type { PortalResponse } from '../portal/contracts.js';
import { PortalApplication } from '../portal/application.js';
import { createMaxBot } from '../platform/max/create-max-bot.js';
import { processMaxEvent } from '../platform/max/update-processor.js';
import { MaxOutboundRateLimiter } from '../platform/max/rate-limiter.js';
import { createPortalRuntime } from '../infrastructure/runtime/portal-runtime.js';
import { PortalMetrics } from '../observability/metrics.js';
import type { RequestContext } from '../core/principal.js';
import type { PortalEvent } from '../portal/contracts.js';

const requestFor = (event: PortalEvent): RequestContext => ({ requestId: event.eventId, source: 'max', principal: event.principal });

/** Empty composition root. Add application modules here; the platform ships no domain actions or buttons. */
export const createPortalApplication = (runtime: ReturnType<typeof createPortalRuntime>, logger: ReturnType<typeof createLogger>): PortalApplication | undefined => {
  if (!runtime.storage) return undefined;
  return new PortalApplication({ storage: runtime.storage, ephemeral: runtime.ephemeral, logger });
};

export const startBot = async (): Promise<void> => {
  const logger = createLogger({ level: config.logLevel, bindings: { component: 'max-bot-entrypoint' } });
  const runtime = createPortalRuntime(config);
  const application = createPortalApplication(runtime, logger);
  const metrics = new PortalMetrics();
  const maxApiLimiter = new MaxOutboundRateLimiter({ store: runtime.ephemeral, key: 'max-api' });
  const adapter = createMaxBot({
    config,
    logger,
    isAdmin: (userId) => config.adminUserIds.includes(userId),
    onEvent: async (event): Promise<PortalResponse | void> => {
      await runtime.store.recordUser({ userId: event.principal.userId, ...(event.chatId ? { chatId: event.chatId } : {}) });
      let response: PortalResponse | void = undefined;
      const result = await processMaxEvent(event, async (normalizedEvent) => {
        if (normalizedEvent.kind === 'lifecycle' || !application) return;
        response = await application.handle(normalizedEvent, requestFor(normalizedEvent));
        return response;
      }, { storage: runtime.updateInbox, logger, metrics });
      return result === 'processed' ? response : undefined;
    },
    maxApiLimiter,
    metrics,
  });
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'bot shutdown started');
    try { await adapter.stop(); await runtime.close(); logger.info({ signal }, 'bot shutdown completed'); }
    catch (error) { logger.error({ signal, error: errorToLogFields(error) }, 'bot shutdown failed'); process.exitCode = 1; }
  };
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  try {
    await runtime.readiness();
    await adapter.setCommands([]);
    await adapter.start();
    logger.info({ transport: config.transport }, 'MAX bot started with empty module registry');
  } catch (error) {
    logger.fatal({ error: errorToLogFields(error) }, 'failed to start MAX bot');
    await runtime.close().catch((closeError: unknown) => logger.error({ error: errorToLogFields(closeError) }, 'failed to close bot runtime'));
    process.exitCode = 1;
    throw error;
  }
};
