import { errorToLogFields, AppError, ERROR_CODES } from '../core/errors.js';
import type { HostLifecycle, PortalComposition } from '../runtime/host-contracts.js';
import type { PortalEvent, PortalResponse } from '../portal/contracts.js';
import type { RequestContext } from '../core/principal.js';
import { createMaxBot } from '../platform/max/create-max-bot.js';
import { processMaxEvent } from '../platform/max/update-processor.js';
import { parseCallbackAction, type CallbackActionDefinition } from '../platform/max/callback-actions.js';
import { MaxOutboundRateLimiter } from '../platform/max/rate-limiter.js';

const requestFor = (event: PortalEvent): RequestContext => ({ requestId: event.eventId, source: 'max', principal: event.principal });

const callbackPayload = (event: PortalEvent): string => {
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof (payload as Record<string, unknown>).payload !== 'string') {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Callback MAX имеет недопустимый формат.');
  }
  return (payload as Record<string, unknown>).payload as string;
};

const validateCallback = async (event: PortalEvent, definitions: readonly CallbackActionDefinition[]): Promise<void> => {
  if (event.kind !== 'callback') return;
  await parseCallbackAction(callbackPayload(event), definitions, event.principal);
};

export const createBotHost = (composition: PortalComposition): HostLifecycle => {
  const logger = composition.logger.child({ component: 'max-bot-host' });
  const maxApiLimiter = new MaxOutboundRateLimiter({ store: composition.runtime.ephemeral, key: 'max-api' });
  const callbackDefinitions = composition.callbackDefinitions as readonly CallbackActionDefinition[];
  const adapter = createMaxBot({
    config: composition.config,
    logger,
    isAdmin: (userId) => composition.config.adminUserIds.includes(userId),
    onEvent: async (event): Promise<PortalResponse | void> => {
      try {
        await validateCallback(event, callbackDefinitions);
      } catch (error) {
        composition.metrics.increment('module_callback_denied_total', { module: 'catalog' });
        throw error;
      }
      await composition.runtime.store.recordUser({ userId: event.principal.userId, ...(event.chatId ? { chatId: event.chatId } : {}) });
      let response: PortalResponse | void = undefined;
      const result = await processMaxEvent(event, async (normalizedEvent) => {
        if (normalizedEvent.kind === 'lifecycle' || !composition.application) return;
        response = await composition.application.handle(normalizedEvent, requestFor(normalizedEvent));
        return response;
      }, { storage: composition.runtime.updateInbox, logger, metrics: composition.metrics });
      return result === 'processed' ? response : undefined;
    },
    maxApiLimiter,
    metrics: composition.metrics,
  });
  let started = false;
  let stopped = false;
  return {
    async start() {
      if (started) return;
      await composition.runtime.readiness();
      await adapter.setCommands(composition.commands);
      await adapter.start();
      started = true;
      logger.info({ transport: composition.config.transport, commandCount: composition.commands.length }, 'MAX bot host started');
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await adapter.stop();
        await composition.close();
        logger.info({}, 'MAX bot host stopped');
      } catch (error) {
        logger.error({ error: errorToLogFields(error) }, 'MAX bot host shutdown failed');
        throw error;
      }
    },
  };
};
