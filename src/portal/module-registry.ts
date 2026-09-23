import { AppError, errorToLogFields, ERROR_CODES } from '../core/errors.js';
import { createLogger, type Logger } from '../core/logger.js';
import type { PortalEvent, PortalEventKind, PortalModule } from './contracts.js';
import type {
  ModuleCallbackActionDefinition,
  ModuleDefinition,
  ModuleEventHandler,
  ModuleManifest,
  ModuleReadyCheck,
  ModuleCommand,
  ModuleSetupContext,
  ModulePublishedEventHandler,
} from './module-contracts.js';
import { MODULE_CAPABILITIES } from './module-contracts.js';
import { MODULE_ID_PATTERN, SERVICE_ID_PATTERN } from './module-contracts.js';
import type { ModuleServiceToken } from './communication.js';
import type { PortalHttpRoute } from './ports/http-content.js';
import { resolveModuleOrder } from './module-graph.js';
import { assertDeclaredCapability } from './module-policy.js';
import { createHash } from 'node:crypto';

export type RegisteredPortalModule = Readonly<{
  module: PortalModule;
  actions: readonly ModuleCallbackActionDefinition[];
}>;

export type ModuleEventRegistration = Readonly<{
  moduleId: string;
  kind: PortalEventKind;
  handler: ModuleEventHandler;
}>;

export type ModuleCatalog = Readonly<{
  modules: readonly ModuleDefinition[];
  eventHandlers: ReadonlyMap<PortalEventKind, readonly ModuleEventRegistration[]>;
  moduleEventHandlers: ReadonlyMap<string, readonly Readonly<{ moduleId: string; handler: ModulePublishedEventHandler }>[]>;
  httpRoutes: readonly PortalHttpRoute[];
  callbackDefinitions: readonly (ModuleCallbackActionDefinition & Readonly<{ moduleId: string }>)[];
  commands: readonly ModuleCommand[];
  services: ReadonlyMap<string, unknown>;
  serviceVersions: ReadonlyMap<string, number>;
  migrations: readonly Readonly<{ ownerId: string; version: string; sql: string }>[];
  readinessChecks: readonly ModuleReadyCheck[];
}>;

export type ModuleRegistryOptions = Readonly<{
  requireSecurityReview?: boolean;
}>;

type MutableRegistration = {
  definition: ModuleDefinition;
  eventHandlers: ModuleEventRegistration[];
  moduleEventHandlers: { name: string; moduleId: string; handler: ModulePublishedEventHandler }[];
  routes: PortalHttpRoute[];
  callbacks: (ModuleCallbackActionDefinition & { moduleId: string })[];
  commands: ModuleCommand[];
  readinessChecks: ModuleReadyCheck[];
  providedServices: { token: ModuleServiceToken<unknown>; service: unknown }[];
  requiredServices: Map<string, { version: number; value: unknown; moduleId: string }>;
  setup?: () => void;
};

const ACTION_PART = /^[a-z][a-z0-9_-]{0,31}$/u;
const MODULE_EVENT_NAME = /^[a-z][a-z0-9-]{0,31}\.[a-z][a-z0-9.-]{0,31}$/u;
const EVENT_KINDS = new Set<PortalEventKind>(['message', 'callback', 'bot_started', 'web_app', 'lifecycle']);
const freezeArray = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const immutableMap = <K, V>(entries: Iterable<readonly [K, V]>): ReadonlyMap<K, V> => {
  const map = new Map(entries);
  let readOnly = undefined as unknown as ReadonlyMap<K, V>;
  readOnly = Object.freeze({
    get: (key: K) => map.get(key),
    has: (key: K) => map.has(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    values: () => map.values(),
    forEach: (callback: (value: V, key: K, source: ReadonlyMap<K, V>) => void) => map.forEach((value, key) => callback(value, key, readOnly)),
    get size() { return map.size; },
    [Symbol.iterator]: () => map[Symbol.iterator](),
  });
  return readOnly;
};

const validateManifest = (manifest: ModuleManifest): void => {
  if (!manifest || typeof manifest !== 'object' || !MODULE_ID_PATTERN.test(manifest.id) || !Number.isSafeInteger(manifest.version) || manifest.version < 1 || typeof manifest.publicName !== 'string' || !Array.isArray(manifest.dependsOn) || !Array.isArray(manifest.consumes) || !Array.isArray(manifest.requiresServices) || !Array.isArray(manifest.providesServices) || !Array.isArray(manifest.requiredCapabilities) || (manifest.consumesEvents !== undefined && !Array.isArray(manifest.consumesEvents)) || (manifest.publishesEvents !== undefined && !Array.isArray(manifest.publishesEvents))) {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль портала имеет недопустимый контракт.');
  }
  if (manifest.publicName.trim().length === 0 || manifest.publicName.length > 128) {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль портала имеет недопустимое публичное имя.');
  }
  const dependencies = new Set<string>();
  for (const dependency of manifest.dependsOn) {
    if (!MODULE_ID_PATTERN.test(dependency.id) || dependency.id === manifest.id || dependencies.has(dependency.id) || !Number.isSafeInteger(dependency.minVersion) || dependency.minVersion < 1) {
      throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Зависимости модуля портала имеют недопустимый формат.');
    }
    dependencies.add(dependency.id);
  }
  const consumed = new Set<string>();
  for (const subscription of manifest.consumes) {
    if (!EVENT_KINDS.has(subscription.kind) || (subscription.mode !== 'exclusive' && subscription.mode !== 'broadcast')) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Событие модуля имеет недопустимый формат.');
    if (consumed.has(subscription.kind)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Событие модуля объявлено повторно.');
    consumed.add(subscription.kind);
  }
  for (const serviceId of [...manifest.requiresServices, ...manifest.providesServices]) {
    if (!SERVICE_ID_PATTERN.test(serviceId)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Сервис модуля имеет недопустимый идентификатор.');
  }
  for (const eventName of [...(manifest.consumesEvents ?? []), ...(manifest.publishesEvents ?? [])]) {
    if (!MODULE_EVENT_NAME.test(eventName)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Межмодульное событие имеет недопустимое имя.');
  }
  if (new Set(manifest.consumesEvents ?? []).size !== (manifest.consumesEvents ?? []).length || new Set(manifest.publishesEvents ?? []).size !== (manifest.publishesEvents ?? []).length) {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Межмодульное событие объявлено повторно.');
  }
  if (new Set(manifest.requiredCapabilities).size !== manifest.requiredCapabilities.length || manifest.requiredCapabilities.some((value) => !MODULE_CAPABILITIES.some((known) => known === value))) {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Разрешения модуля имеют недопустимый формат.');
  }
  if (manifest.requiresServices.length > 0 && !manifest.requiredCapabilities.includes('service.require')) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль должен объявить разрешение на использование сервисов.');
  if (manifest.providesServices.length > 0 && !manifest.requiredCapabilities.includes('service.provide')) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль должен объявить разрешение на предоставление сервисов.');
  if ((manifest.publishesEvents?.length ?? 0) > 0 && !manifest.requiredCapabilities.includes('events.publish')) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль должен объявить разрешение на публикацию событий.');
  if (manifest.maxStateBytes !== undefined && (!Number.isSafeInteger(manifest.maxStateBytes) || manifest.maxStateBytes < 1 || manifest.maxStateBytes > 32 * 1024)) {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Лимит состояния модуля имеет недопустимое значение.');
  }
  if (manifest.timeoutMs !== undefined && (!Number.isSafeInteger(manifest.timeoutMs) || manifest.timeoutMs < 1 || manifest.timeoutMs > 30_000)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Тайм-аут модуля имеет недопустимое значение.');
  if (manifest.maxConcurrency !== undefined && (!Number.isSafeInteger(manifest.maxConcurrency) || manifest.maxConcurrency < 1 || manifest.maxConcurrency > 128)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Лимит параллелизма модуля имеет недопустимое значение.');
  if (manifest.securityReview !== undefined) {
    const review = manifest.securityReview;
    if (!review || typeof review !== 'object' || typeof review.owner !== 'string' || !/^[A-Za-zА-Яа-я0-9 ._@-]{2,128}$/u.test(review.owner) || typeof review.threatModel !== 'string' || review.threatModel.trim().length === 0 || review.threatModel.length > 512 || typeof review.reviewedAt !== 'string' || !Number.isFinite(Date.parse(review.reviewedAt)) || !Array.isArray(review.dataClasses) || review.dataClasses.length === 0 || review.dataClasses.some((item) => !['public', 'account', 'personal', 'sensitive'].includes(item))) {
      throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Security review модуля имеет недопустимый формат.');
    }
  }
};

const validateCallback = (definition: ModuleCallbackActionDefinition): void => {
  if (!ACTION_PART.test(definition.namespace) || !ACTION_PART.test(definition.verb)) {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Callback модуля имеет недопустимый идентификатор.');
  }
  if (definition.requiresResource && !definition.authorize) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Ресурсный callback модуля должен иметь authorization policy.');
};

const routeKey = (route: PortalHttpRoute): string => {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method) || !['public', 'principal', 'admin'].includes(route.access)) {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'HTTP route модуля имеет недопустимую политику доступа.');
  }
  if (typeof route.match === 'string' && !route.match.startsWith('/api/v1/')) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'HTTP route модуля должен находиться под /api/v1/.');
  if (route.id !== undefined) {
    if (!/^[a-z][a-z0-9._-]{0,63}$/u.test(route.id)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'HTTP route модуля имеет недопустимый идентификатор.');
    return `${route.method}:${route.id}`;
  }
  if (typeof route.match === 'string') {
    return `${route.method}:${route.match}`;
  }
  throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'HTTP route модуля должен иметь стабильный идентификатор.');
};

const commandKey = (command: ModuleCommand): string => command.name.trim().toLowerCase();
const migrationKey = (ownerId: string, version: string): string => `${ownerId}:${version}`;

export class PortalModuleRegistry {
  private readonly modules = new Map<string, RegisteredPortalModule>();
  private readonly definitions = new Map<string, MutableRegistration>();
  private finalized?: ModuleCatalog;
  private readonly logger: Logger;
  private readonly requireSecurityReview: boolean;

  constructor(logger: Logger = createLogger({ bindings: { component: 'module-registry' } }), options: ModuleRegistryOptions = {}) {
    this.logger = logger;
    this.requireSecurityReview = options.requireSecurityReview ?? false;
  }

  register(module: PortalModule, actions: readonly ModuleCallbackActionDefinition[] = []): void {
    if (!MODULE_ID_PATTERN.test(module.id) || !Number.isSafeInteger(module.version) || module.version < 1) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Модуль портала имеет недопустимый контракт.');
    if (this.requireSecurityReview) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Production modules must use a reviewed definition contract.');
    if (this.modules.has(module.id) || this.definitions.has(module.id) || this.finalized) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль портала зарегистрирован повторно или каталог уже закрыт.');
    this.modules.set(module.id, { module, actions: Object.freeze([...actions]) });
  }

  registerDefinition(definition: ModuleDefinition): void {
    if (this.finalized) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Каталог модулей уже закрыт.');
    validateManifest(definition.manifest);
    if (this.requireSecurityReview && !definition.manifest.securityReview) {
      throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Production module requires an explicit security review.');
    }
    const { id } = definition.manifest;
    if (this.modules.has(id) || this.definitions.has(id)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль портала зарегистрирован повторно.');
    const registration: MutableRegistration = {
      definition,
      eventHandlers: [],
      moduleEventHandlers: [],
      routes: [],
      callbacks: [],
      commands: [],
      readinessChecks: [],
      providedServices: [],
      requiredServices: new Map(),
    };
    const context: ModuleSetupContext = {
      onEvent: (kind, handler) => {
        const subscription = definition.manifest.consumes.find((candidate) => candidate.kind === kind);
        if (!subscription) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль зарегистрировал необъявленное событие.');
        registration.eventHandlers.push({ moduleId: id, kind, handler });
      },
      onModuleEvent: (name, handler) => {
        if (!MODULE_EVENT_NAME.test(name)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Событие модуля имеет недопустимое имя.');
        if (!definition.manifest.consumesEvents?.includes(name)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль зарегистрировал необъявленное межмодульное событие.');
        const ownerId = name.slice(0, name.indexOf('.'));
        if (ownerId !== id && !definition.manifest.dependsOn.some((dependency) => dependency.id === ownerId)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Зависимость модуля для межмодульного события не объявлена.');
        registration.moduleEventHandlers.push({ name, moduleId: id, handler });
      },
      registerHttpRoute: (route) => {
        assertDeclaredCapability(definition.manifest, 'http.route');
        routeKey(route);
        registration.routes.push(Object.freeze({ ...route, moduleId: id }));
      },
      registerCallbackAction: (callback) => {
        assertDeclaredCapability(definition.manifest, 'callback.action');
        validateCallback(callback);
        registration.callbacks.push({ ...callback, moduleId: id });
      },
      registerCommand: (command) => {
        assertDeclaredCapability(definition.manifest, 'command.register');
        if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(command.name) || command.description.trim().length === 0 || command.description.length > 256) {
          throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Команда модуля имеет недопустимый формат.');
        }
        registration.commands.push(Object.freeze({ ...command }));
      },
      provideService: (token: ModuleServiceToken<unknown>, service: unknown) => {
        if (!Number.isSafeInteger(token.version) || token.version < 1) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Версия сервиса модуля имеет недопустимый формат.');
        assertDeclaredCapability(definition.manifest, 'service.provide');
        if (!definition.manifest.providesServices.includes(token.id)) {
          throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль предоставил необъявленный сервис.');
        }
        registration.providedServices.push({ token, service });
      },
      requireService: <T>(token: ModuleServiceToken<T>): T => {
        if (!Number.isSafeInteger(token.version) || token.version < 1) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Версия сервиса модуля имеет недопустимый формат.');
        assertDeclaredCapability(definition.manifest, 'service.require');
        if (!definition.manifest.requiresServices.includes(token.id)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль запросил необъявленный сервис.');
        const service = registration.requiredServices.get(token.id);
        if (!service || service.version < token.version) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Требуемый сервис модуля недоступен.');
        return service.value as T;
      },
      addReadinessCheck: (check) => {
        if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(check.name)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Проверка готовности модуля имеет недопустимое имя.');
        registration.readinessChecks.push(check);
      },
    };
    registration.setup = () => definition.setup(context);
    this.definitions.set(id, registration);
    this.logger.info({ moduleId: id, moduleVersion: definition.manifest.version }, 'module registered');
  }

  finalize(): ModuleCatalog {
    if (this.finalized) return this.finalized;
    const registrations = [...this.definitions.values()];
    const allIds = new Set([...this.modules.keys(), ...this.definitions.keys()]);
    for (const registration of registrations) {
      for (const dependency of registration.definition.manifest.dependsOn) {
        if (!allIds.has(dependency.id)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Зависимость модуля не зарегистрирована.');
        const dependencyRegistration = this.definitions.get(dependency.id);
        const dependencyVersion = dependencyRegistration?.definition.manifest.version ?? this.modules.get(dependency.id)?.module.version ?? 0;
        if (dependencyVersion < dependency.minVersion) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Версия зависимости модуля не поддерживается.');
      }
    }
    const serviceProviders = new Map<string, string>();
    for (const registration of registrations) {
      for (const serviceId of registration.definition.manifest.providesServices) {
        if (serviceProviders.has(serviceId)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Сервис модуля предоставлен повторно.');
        serviceProviders.set(serviceId, registration.definition.manifest.id);
      }
      for (const serviceId of registration.definition.manifest.requiresServices) {
        const providerId = serviceProviders.get(serviceId) ?? registrations.find((candidate) => candidate.definition.manifest.providesServices.includes(serviceId))?.definition.manifest.id;
        if (!providerId) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Требуемый сервис модуля не зарегистрирован.');
        if (providerId !== registration.definition.manifest.id && !registration.definition.manifest.dependsOn.some((dependency) => dependency.id === providerId)) {
          throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Зависимость модуля для сервиса не объявлена.');
        }
      }
    }
    const definitionMap = new Map(registrations.map((registration) => [registration.definition.manifest.id, registration.definition]));
    const ordered = resolveModuleOrder(definitionMap).map((id) => this.definitions.get(id)).filter((registration): registration is MutableRegistration => registration !== undefined);
    const services = new Map<string, { version: number; value: unknown; moduleId: string }>();
    for (const registration of ordered) {
      for (const serviceId of registration.definition.manifest.requiresServices) {
        const service = services.get(serviceId);
        if (service) registration.requiredServices.set(serviceId, service);
      }
      try {
        const setup = registration.setup;
        registration.setup = undefined;
        setup?.();
      } catch (error) {
        this.logger.error({ moduleId: registration.definition.manifest.id, error: errorToLogFields(error) }, 'module registration failed');
        throw error;
      }
      for (const provided of registration.providedServices) {
        const existing = services.get(provided.token.id);
        if (existing) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Сервис модуля предоставлен повторно.');
        services.set(provided.token.id, { version: provided.token.version, value: provided.service, moduleId: registration.definition.manifest.id });
      }
    }
    const migrations: { ownerId: string; version: string; sql: string }[] = [];
    const migrationKeys = new Set<string>();
    for (const registration of ordered) {
      for (const migration of registration.definition.migrations ?? []) {
        if (!/^\d+_[a-z][a-z0-9_-]{0,95}$/u.test(migration.version) || migration.sql.trim().length === 0 || Buffer.byteLength(migration.sql, 'utf8') > 256 * 1024) {
          throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Миграция модуля имеет недопустимый формат.');
        }
        const key = migrationKey(registration.definition.manifest.id, migration.version);
        if (migrationKeys.has(key)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Миграция модуля зарегистрирована повторно.');
        migrationKeys.add(key);
        migrations.push({ ownerId: registration.definition.manifest.id, version: migration.version, sql: migration.sql });
      }
    }
    const callbacks = ordered.flatMap((registration) => registration.callbacks);
    const callbackKeys = new Set<string>();
    for (const callback of callbacks) {
      const key = `${callback.namespace}:${callback.verb}`;
      if (callbackKeys.has(key)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Callback модулей зарегистрирован повторно.');
      callbackKeys.add(key);
    }
    const routes = ordered.flatMap((registration) => registration.routes);
    const routeKeys = new Set<string>();
    for (const route of routes) {
      const key = routeKey(route);
      if (routeKeys.has(key)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'HTTP route модулей зарегистрирован повторно.');
      routeKeys.add(key);
    }
    const commands = ordered.flatMap((registration) => registration.commands);
    const commandKeys = new Set<string>();
    for (const command of commands) {
      const key = commandKey(command);
      if (commandKeys.has(key)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Команда модулей зарегистрирована повторно.');
      commandKeys.add(key);
    }
    const eventHandlers = new Map<PortalEventKind, ModuleEventRegistration[]>();
    for (const registration of ordered) {
      for (const event of registration.eventHandlers) {
        const list = eventHandlers.get(event.kind) ?? [];
        const subscription = registration.definition.manifest.consumes.find((candidate) => candidate.kind === event.kind);
        if (subscription?.mode === 'exclusive' && list.some((candidate) => {
          const existing = this.definitions.get(candidate.moduleId)?.definition.manifest.consumes.find((item) => item.kind === event.kind);
          return existing?.mode === 'exclusive';
        })) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Эксклюзивное событие модулей зарегистрировано повторно.');
        list.push(event);
        eventHandlers.set(event.kind, list);
      }
    }
    const moduleEventHandlers = new Map<string, { moduleId: string; handler: ModulePublishedEventHandler }[]>();
    for (const registration of ordered) {
      for (const event of registration.moduleEventHandlers) {
        const list = moduleEventHandlers.get(event.name) ?? [];
        if (list.length >= 32) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Слишком много подписчиков межмодульного события.');
        if (list.some((candidate) => candidate.moduleId === event.moduleId)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Подписчик межмодульного события зарегистрирован повторно.');
        list.push({ moduleId: event.moduleId, handler: event.handler });
        moduleEventHandlers.set(event.name, list);
      }
    }
    const modules = ordered.map((registration) => registration.definition);
    const moduleIdHash = createHash('sha256').update(modules.map((module) => `${module.manifest.id}@${module.manifest.version}`).join('|')).digest('hex').slice(0, 16);
    this.finalized = Object.freeze({
      modules: freezeArray(modules),
      eventHandlers: immutableMap([...eventHandlers.entries()].map(([kind, handlers]) => [kind, freezeArray(handlers)])),
      moduleEventHandlers: immutableMap([...moduleEventHandlers.entries()].map(([name, handlers]) => [name, freezeArray(handlers)])),
      httpRoutes: freezeArray(routes),
      callbackDefinitions: freezeArray(callbacks),
      commands: freezeArray(commands),
      services: immutableMap([...services.entries()].map(([id, value]) => [id, value.value])),
      serviceVersions: immutableMap([...services.entries()].map(([id, value]) => [id, value.version])),
      migrations: freezeArray(migrations),
      readinessChecks: freezeArray(ordered.flatMap((registration) => registration.readinessChecks)),
    });
    this.logger.info({ moduleCount: modules.length, routeCount: routes.length, callbackCount: callbacks.length, moduleIdHash, eventHandlerCount: [...eventHandlers.values()].reduce((total, handlers) => total + handlers.length, 0) }, 'module graph finalized');
    return this.finalized;
  }

  find(event: Parameters<PortalModule['canHandle']>[0]): RegisteredPortalModule | undefined {
    return [...this.modules.values()].find((entry) => entry.module.canHandle(event));
  }

  get(id: string): RegisteredPortalModule | undefined { return this.modules.get(id); }

  all(): readonly RegisteredPortalModule[] { return [...this.modules.values()]; }
}
