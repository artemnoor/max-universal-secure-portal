import type { RequestContext } from '../core/principal.js';
import type { PortalEvent, PortalEventKind, PortalResponse } from './contracts.js';
import type { ModuleContext } from './module-context.js';
import type { PortalHttpRoute } from './ports/http-content.js';
import type { ModuleServiceToken } from './communication.js';
import type { ModuleEventEnvelope } from './communication.js';

export const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
export const SERVICE_ID_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u;

export type ModuleEventMode = 'exclusive' | 'broadcast';
export type ModuleEventSubscription = Readonly<{ kind: PortalEventKind; mode: ModuleEventMode }>;
export type ModuleDependency = Readonly<{ id: string; minVersion: number }>;
export type ModuleSecurityReview = Readonly<{
  owner: string;
  reviewedAt: string;
  threatModel: string;
  dataClasses: readonly ('public' | 'account' | 'personal' | 'sensitive')[];
}>;
export const MODULE_CAPABILITIES = [
  'user.read',
  'user.write',
  'state.read',
  'state.write',
  'saved-items.read',
  'saved-items.write',
  'events.publish',
  'audit.write',
  'http.route',
  'callback.action',
  'command.register',
  'service.provide',
  'service.require',
  'pii.read',
  'pii.write',
] as const;
export type ModuleCapability = string;

export type ModuleManifest = Readonly<{
  id: string;
  version: number;
  publicName: string;
  dependsOn: readonly ModuleDependency[];
  consumes: readonly ModuleEventSubscription[];
  requiresServices: readonly string[];
  providesServices: readonly string[];
  requiredCapabilities: readonly ModuleCapability[];
  maxStateBytes?: number;
  consumesEvents?: readonly string[];
  publishesEvents?: readonly string[];
  timeoutMs?: number;
  maxConcurrency?: number;
  securityReview?: ModuleSecurityReview;
}>;

export type ModuleResult = Readonly<{
  response?: PortalResponse;
  statePatch?: unknown;
  events?: readonly Readonly<{ name: string; version: number; payload: unknown }>[];
}>;

export type ModuleEventHandler = (event: PortalEvent, context: ModuleContext) => Promise<ModuleResult | PortalResponse | void>;
export type ModulePublishedEventHandler = (event: ModuleEventEnvelope, context: ModuleContext) => Promise<void> | void;
export type ModuleReadyCheck = Readonly<{ name: string; check: () => Promise<void> }>;
export type ModuleCommand = Readonly<{ name: string; description: string }>;
export type ModuleMigration = Readonly<{ version: string; sql: string }>;

export type ModuleSetupContext = Readonly<{
  onEvent(kind: PortalEventKind, handler: ModuleEventHandler): void;
  onModuleEvent(name: string, handler: ModulePublishedEventHandler): void;
  registerHttpRoute(route: PortalHttpRoute): void;
  registerCallbackAction(definition: ModuleCallbackActionDefinition): void;
  registerCommand(command: ModuleCommand): void;
  provideService<T>(token: ModuleServiceToken<T>, service: T): void;
  requireService<T>(token: ModuleServiceToken<T>): T;
  addReadinessCheck(check: ModuleReadyCheck): void;
}>;

export type ModuleCallbackActionDefinition = Readonly<{
  namespace: string;
  verb: string;
  requiresResource?: boolean;
  authorize?: (action: Readonly<{ namespace: string; verb: string; resource?: string; raw: string }>, principal: Readonly<{ userId: number; role: 'user' | 'admin' }>) => Promise<boolean> | boolean;
}>;

export type ModuleDefinition = Readonly<{
  manifest: ModuleManifest;
  setup(context: ModuleSetupContext): void;
  migrations?: readonly ModuleMigration[];
  dispose?(): Promise<void> | void;
}>;

export type LegacyModuleAdapter = Readonly<{
  id: string;
  version: number;
  canHandle(event: PortalEvent): boolean;
  handle(event: PortalEvent, context: Readonly<{ request: RequestContext; state: Readonly<Record<string, unknown>>; handleAction: unknown }>): Promise<PortalResponse>;
}>;
