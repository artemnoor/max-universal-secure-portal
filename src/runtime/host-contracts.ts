import type { AppConfig } from '../core/config.js';
import type { Logger } from '../core/logger.js';
import type { ModuleCatalog } from '../portal/module-registry.js';
import type { PortalApplication } from '../portal/application.js';
import type { PortalHttpContent } from '../portal/ports/http-content.js';
import type { PortalRuntime } from '../infrastructure/runtime/portal-runtime.js';
import type { PortalMetrics } from '../observability/metrics.js';
import type { ModuleCallbackActionDefinition, ModuleCommand } from '../portal/module-contracts.js';

export type PortalComposition = Readonly<{
  config: AppConfig;
  logger: Logger;
  runtime: PortalRuntime;
  application?: PortalApplication;
  catalog: ModuleCatalog;
  httpContent: PortalHttpContent;
  callbackDefinitions: readonly ModuleCallbackActionDefinition[];
  commands: readonly ModuleCommand[];
  metrics: PortalMetrics;
  close(): Promise<void>;
}>;

export type HostLifecycle = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
}>;
