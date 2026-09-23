import type { Logger } from '../core/logger.js';
import type { PortalPrincipal, RequestContext } from '../core/principal.js';
import type { StoragePort } from './ports/storage.js';

export type PortalContext = Readonly<{
  principal: PortalPrincipal;
  request: RequestContext;
  eventId: string;
  locale: string;
  now: Date;
  storage: StoragePort;
  capabilities: ReadonlySet<string>;
  logger: Logger;
  state: Readonly<Record<string, unknown>>;
}>;

