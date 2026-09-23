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
import type { ModuleContext } from './module-context.js';
import type { ModuleDefinition, ModuleResult, ModulePublishedEventHandler } from './module-contracts.js';
import type { ModuleEventEnvelope, ModuleServiceToken } from './communication.js';
import { assertModuleEventEnvelope } from './communication.js';
import { createModuleStorage } from './ports/module-storage.js';
import { assertConversationStateSize } from './ports/storage.js';
import { createDeniedModulePii, type ModulePiiFactory } from './ports/module-pii.js';
import type { ModuleCatalog, ModuleEventRegistration } from './module-registry.js';
import { hasAllCapabilities } from './module-policy.js';
import type { PortalMetrics } from '../observability/metrics.js';

export type PortalApplicationOptions = Readonly<{
  storage: StoragePort;
  ephemeral?: EphemeralStore;
  registry?: PortalModuleRegistry;
  logger?: Logger;
  lockTtlSeconds?: number;
  capabilities?: ReadonlySet<string>;
  moduleCatalog?: ModuleCatalog;
  modulePiiFactory?: ModulePiiFactory;
  metrics?: PortalMetrics;
}>;

export class PortalApplication {
  readonly registry: PortalModuleRegistry;
  private readonly logger: Logger;
  private readonly lockTtlSeconds: number;
  private moduleCatalog?: ModuleCatalog;
  private hasModuleDefinitions = false;
  private readonly moduleInFlight = new Map<string, number>();

  constructor(private readonly options: PortalApplicationOptions) {
    this.registry = options.registry ?? new PortalModuleRegistry();
    this.logger = options.logger ?? createLogger({ bindings: { component: 'portal.application' } });
    this.lockTtlSeconds = options.lockTtlSeconds ?? 15;
    this.moduleCatalog = options.moduleCatalog;
  }

  registerModule(module: PortalModule, actions: Parameters<PortalModuleRegistry['register']>[1] = []): void {
    this.registry.register(module, actions);
  }

  registerModuleDefinition(definition: ModuleDefinition): void {
    this.registry.registerDefinition(definition);
    this.hasModuleDefinitions = true;
  }

  finalizeModules(): ModuleCatalog {
    this.moduleCatalog = this.registry.finalize();
    return this.moduleCatalog;
  }

  getModuleCatalog(): ModuleCatalog | undefined {
    return this.moduleCatalog;
  }

  async handle(event: PortalEvent, request: RequestContext): Promise<PortalResponse> {
    const catalog = this.moduleCatalog ?? (this.hasModuleDefinitions ? this.finalizeModules() : undefined);
    const catalogHandlers = catalog?.eventHandlers.get(event.kind) ?? [];
    if (catalog && catalogHandlers.length > 0) return this.handleCatalogEvent(event, request, catalog, catalogHandlers);
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

  private async handleCatalogEvent(
    event: PortalEvent,
    request: RequestContext,
    catalog: ModuleCatalog,
    registrations: readonly ModuleEventRegistration[],
  ): Promise<PortalResponse> {
    this.assertRequestPrincipal(event, request);
    let lockToken: string | undefined;
    if (this.options.ephemeral) {
      lockToken = await this.options.ephemeral.acquireUserLock(event.principal.userId, this.lockTtlSeconds);
      if (!lockToken) throw new AppError(ERROR_CODES.RATE_LIMITED, 429, 'Предыдущая операция ещё выполняется.');
    }
    const startedAt = Date.now();
    let selectedResponse: PortalResponse | undefined;
    try {
      for (const registration of registrations) {
        const result = await this.invokeModuleHandler(registration.moduleId, registration.handler, event, request, catalog, 0);
        const response = this.moduleResponse(result);
        if (response && !selectedResponse) selectedResponse = response;
      }
      const response = selectedResponse ?? { text: '', actions: [] };
      this.logger.info({ eventId: event.eventId, moduleCount: registrations.length, durationMs: Date.now() - startedAt }, 'module event handled');
      return response;
    } catch (error) {
      this.logger.error({ eventId: event.eventId, error: errorToLogFields(error) }, 'module event failed');
      if (error instanceof AppError) throw error;
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, 500, undefined, { cause: error });
    } finally {
      if (lockToken && this.options.ephemeral) await this.options.ephemeral.releaseUserLock(event.principal.userId, lockToken);
    }
  }

  private async invokeModuleHandler(
    moduleId: string,
    handler: (event: PortalEvent, context: ModuleContext) => Promise<ModuleResult | PortalResponse | void>,
    event: PortalEvent,
    request: RequestContext,
    catalog: ModuleCatalog,
    eventDepth: number,
  ): Promise<ModuleResult | PortalResponse | void> {
    const definition = catalog.modules.find((candidate) => candidate.manifest.id === moduleId);
    if (!definition) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль события не найден.');
    if (!hasAllCapabilities(definition.manifest, this.options.capabilities ?? new Set())) {
      this.options.metrics?.increment('module_capability_denied_total', { module: moduleId });
      throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Модулю не выдано требуемое разрешение.');
    }
    const maxConcurrency = definition.manifest.maxConcurrency ?? 16;
    const inFlight = this.moduleInFlight.get(moduleId) ?? 0;
    if (inFlight >= maxConcurrency) {
      this.options.metrics?.increment('module_concurrency_denied_total', { module: moduleId });
      throw new AppError(ERROR_CODES.RATE_LIMITED, 429, 'Модуль временно занят.');
    }
    this.moduleInFlight.set(moduleId, inFlight + 1);
    try {
      const moduleStorage = createModuleStorage(event.principal, this.options.storage, moduleId, definition.manifest.maxStateBytes, request.requestId);
    const stateRecord = await moduleStorage.getState();
      const moduleState = Object.freeze({ ...(stateRecord?.state ?? {}) });
    const moduleLogger = this.logger.child({ moduleId, moduleVersion: definition.manifest.version, requestId: request.requestId, eventId: event.eventId });
    const context: ModuleContext = Object.freeze({
      moduleId,
      moduleVersion: definition.manifest.version,
      principal: event.principal,
      request: { ...request, principal: event.principal },
      eventId: event.eventId,
      now: event.receivedAt,
      locale: 'ru',
      state: moduleState,
      capabilities: this.options.capabilities ?? new Set(),
      storage: moduleStorage,
      audit: { append: (action, resourceType, resourceId, metadata) => moduleStorage.appendAudit(action, resourceType, resourceId, metadata) },
      pii: definition.manifest.requiredCapabilities.includes('pii.read') && definition.manifest.requiredCapabilities.includes('pii.write')
        ? this.options.modulePiiFactory?.(event.principal, moduleId) ?? createDeniedModulePii()
        : createDeniedModulePii(),
      services: {
        resolve: <T>(token: ModuleServiceToken<T>): T => {
          if (!definition.manifest.requiresServices.includes(token.id)) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Сервис модуля не объявлен в зависимостях.');
          const service = catalog.services.get(token.id);
          const version = catalog.serviceVersions.get(token.id);
          if (!service || version === undefined || version < token.version) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Сервис модуля недоступен.');
          return service as T;
        },
      },
      publish: async (published) => {
        if (eventDepth >= 4) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Глубина межмодульных событий превышена.');
        const envelope: ModuleEventEnvelope = { ...published, moduleId };
        if (!definition.manifest.publishesEvents?.includes(envelope.name) || !envelope.name.startsWith(`${moduleId}.`)) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Событие модуля не объявлено.');
        assertModuleEventEnvelope(envelope);
        await this.dispatchModuleEvent(envelope, event, request, catalog, eventDepth + 1);
      },
      logger: moduleLogger,
    });
      const result = await this.withModuleTimeout(handler(event, context), definition.manifest.timeoutMs ?? 5_000, moduleId);
      this.moduleResponse(result);
      await this.applyModuleResult(result, context, moduleStorage, stateRecord?.version);
      return result;
    } finally {
      const remaining = (this.moduleInFlight.get(moduleId) ?? 1) - 1;
      if (remaining > 0) this.moduleInFlight.set(moduleId, remaining);
      else this.moduleInFlight.delete(moduleId);
    }
  }

  private async withModuleTimeout<T>(operation: Promise<T>, timeoutMs: number, moduleId: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            this.options.metrics?.increment('module_timeout_total', { module: moduleId });
            reject(new AppError(ERROR_CODES.DEPENDENCY_UNAVAILABLE, 504, 'Модуль не ответил вовремя.'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async dispatchModuleEvent(
    envelope: ModuleEventEnvelope,
    sourceEvent: PortalEvent,
    request: RequestContext,
    catalog: ModuleCatalog,
    eventDepth: number,
  ): Promise<void> {
    const subscribers = catalog.moduleEventHandlers.get(envelope.name) ?? [];
    for (const subscriber of subscribers) {
      try {
        await this.invokeModuleHandler(subscriber.moduleId, async (_event, context) => subscriber.handler(envelope, context), sourceEvent, request, catalog, eventDepth);
      } catch (error) {
        this.logger.warn({ event: envelope.name, moduleId: subscriber.moduleId, error: errorToLogFields(error) }, 'module event subscriber failed');
      }
    }
  }

  private async applyModuleResult(
    result: ModuleResult | PortalResponse | void,
    context: ModuleContext,
    storage: ReturnType<typeof createModuleStorage>,
    expectedVersion?: number,
  ): Promise<void> {
    const statePatch = this.moduleStatePatch(result);
    if (statePatch !== undefined) {
      const nextState = { ...context.state, ...statePatch };
      try { assertConversationStateSize(nextState); } catch (error) {
        this.options.metrics?.increment('module_state_quota_rejected_total', { module: context.moduleId });
        throw error;
      }
      await storage.saveState(nextState, expectedVersion);
    }
    const events = this.moduleEvents(result);
    for (const event of events) await context.publish(event);
  }

  private moduleResponse(result: ModuleResult | PortalResponse | void): PortalResponse | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const candidate = 'text' in result ? result : 'response' in result ? result.response : undefined;
    if (candidate === undefined) return undefined;
    return portalResponseSchema.parse(candidate);
  }

  private moduleStatePatch(result: ModuleResult | PortalResponse | void): Record<string, unknown> | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const patch = 'text' in result ? result.statePatch : 'statePatch' in result ? result.statePatch : result.response?.statePatch;
    if (patch === undefined) return undefined;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Изменение состояния модуля имеет недопустимый формат.');
    return patch as Record<string, unknown>;
  }

  private moduleEvents(result: ModuleResult | PortalResponse | void): readonly Readonly<{ name: string; version: number; payload: unknown }>[] {
    if (!result || typeof result !== 'object' || 'text' in result || !('events' in result) || result.events === undefined) return [];
    if (!Array.isArray(result.events) || result.events.length > 32) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Модуль вернул слишком много событий.');
    return result.events;
  }

  private assertRequestPrincipal(event: PortalEvent, request: RequestContext): void {
    if (request.principal && request.principal.userId !== event.principal.userId) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Контекст запроса не соответствует пользователю.');
  }
}
