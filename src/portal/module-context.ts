import type { Logger } from '../core/logger.js';
import type { PortalPrincipal, RequestContext } from '../core/principal.js';
import type { ModuleEventEnvelope, ModuleEventPublisher, ModuleServiceResolver } from './communication.js';
import type { ModuleStorage } from './ports/module-storage.js';
import type { ModulePii } from './ports/module-pii.js';

export type ModuleAuditWriter = Readonly<{
  append(action: string, resourceType: string, resourceId?: string, metadata?: Readonly<Record<string, boolean | number | string | null>>): Promise<void>;
}>;

export type ModuleContext = Readonly<{
  moduleId: string;
  moduleVersion: number;
  principal: PortalPrincipal;
  request: RequestContext;
  eventId: string;
  now: Date;
  locale: string;
  state: Readonly<Record<string, unknown>>;
  capabilities: ReadonlySet<string>;
  storage: ModuleStorage;
  audit: ModuleAuditWriter;
  pii: ModulePii;
  services: ModuleServiceResolver;
  publish(event: Omit<ModuleEventEnvelope, 'moduleId'>): Promise<void>;
  logger: Logger;
}>;
