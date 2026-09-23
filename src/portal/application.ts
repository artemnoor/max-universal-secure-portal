import { AppError, errorToLogFields, ERROR_CODES } from '../core/errors.js';
import { createLogger, type Logger } from '../core/logger.js';
import type { PortalEvent, PortalModule, PortalModuleContext, PortalResponse } from './contracts.js';
import type { PortalContext } from './context.js';
import type { RequestContext } from '../core/principal.js';
import type { EphemeralStore } from './ports/ephemeral.js';
import type { StoragePort } from './ports/storage.js';
import { parseConversationState, transitionConversationState } from './state.js';
import { PortalModuleRegistry } from './module-registry.js';
import { portalResponseSchema } from './contracts.js';

export type PortalApplicationOptions = Readonly<{
  storage: StoragePort;
  ephemeral?: EphemeralStore;
  registry?: PortalModuleRegistry;
  logger?: Logger;
  lockTtlSeconds?: number;
  capabilities?: ReadonlySet<string>;
}>;

export class PortalApplication {
  readonly registry: PortalModuleRegistry;
  private readonly logger: Logger;
  private readonly lockTtlSeconds: number;

  constructor(private readonly options: PortalApplicationOptions) {
    this.registry = options.registry ?? new PortalModuleRegistry();
    this.logger = options.logger ?? createLogger({ bindings: { component: 'portal.application' } });
    this.lockTtlSeconds = options.lockTtlSeconds ?? 15;
  }

  registerModule(module: PortalModule, actions: Parameters<PortalModuleRegistry['register']>[1] = []): void {
    this.registry.register(module, actions);
  }

  async handle(event: PortalEvent, request: RequestContext): Promise<PortalResponse> {
    const registration = this.registry.find(event);
    if (!registration) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Сценарий портала недоступен.');
    let lockToken: string | undefined;
    if (this.options.ephemeral) {
      lockToken = await this.options.ephemeral.acquireUserLock(event.principal.userId, this.lockTtlSeconds);
      if (!lockToken) throw new AppError(ERROR_CODES.RATE_LIMITED, 429, 'Предыдущая операция ещё выполняется.');
    }

    const startedAt = Date.now();
    try {
      const stateRecord = await this.options.storage.conversationStates.get(event.principal);
      const state = parseConversationState(stateRecord?.state);
      const context: PortalContext = {
        principal: event.principal,
        request,
        eventId: event.eventId,
        locale: 'ru',
        now: event.receivedAt,
        storage: this.options.storage,
        capabilities: this.options.capabilities ?? new Set(),
        logger: this.logger,
        state,
      };
      const moduleContext: PortalModuleContext = {
        request: context.request,
        state: context.state,
        portal: context,
        handleAction: async (actionEvent, _action, actionContext) => {
          if (actionContext.principal && actionContext.principal.userId !== context.principal.userId) {
            throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Вложенное действие недоступно.');
          }
          return registration.module.handle(actionEvent, {
            request: actionContext,
            state,
            portal: context,
            handleAction: async () => { throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Вложенное действие недоступно.'); },
          });
        },
      };
      const response = await registration.module.handle(event, moduleContext);
      const parsed = portalResponseSchema.parse(response);
      if (parsed.statePatch !== undefined) {
        const nextState = transitionConversationState(state, parsed.statePatch);
        await this.options.storage.conversationStates.save(event.principal, nextState, stateRecord?.version);
      }
      this.logger.info({ eventId: event.eventId, module: registration.module.id, durationMs: Date.now() - startedAt }, 'portal event handled');
      return parsed;
    } catch (error) {
      this.logger.error({ eventId: event.eventId, module: registration.module.id, error: errorToLogFields(error) }, 'portal event failed');
      if (error instanceof AppError) throw error;
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 500, undefined, { cause: error });
    } finally {
      if (lockToken && this.options.ephemeral) await this.options.ephemeral.releaseUserLock(event.principal.userId, lockToken);
    }
  }

  async handleMessage(event: PortalEvent, request: RequestContext): Promise<PortalResponse> { return this.handle(event, request); }
  async handleAction(event: PortalEvent, request: RequestContext): Promise<PortalResponse> { return this.handle(event, request); }
}
