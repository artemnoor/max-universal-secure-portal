import type { AppConfig } from '../core/config.js';
import { AppError, ERROR_CODES } from '../core/errors.js';
import { createLogger, type Logger } from '../core/logger.js';
import { PortalApplication } from '../portal/application.js';
import type { ModuleDefinition } from '../portal/module-contracts.js';
import { PortalModuleRegistry } from '../portal/module-registry.js';
import { createModuleHttpContent, moduleCallbackDefinitions, moduleCommands } from '../portal/module-surfaces.js';
import { createPortalRuntime } from '../infrastructure/runtime/portal-runtime.js';
import { PortalMetrics } from '../observability/metrics.js';
import type { PortalComposition } from '../runtime/host-contracts.js';
import { createModulePiiFactory } from '../infrastructure/security/module-pii.js';
import { DEFAULT_MODULE_CAPABILITIES } from '../portal/module-policy.js';

export type CompositionOptions = Readonly<{
  logger?: Logger;
  modules?: readonly ModuleDefinition[];
}>;

/** The only place where adapters, kernel, modules and host-facing surfaces are assembled. */
export const createPortalComposition = (config: AppConfig, options: CompositionOptions = {}): PortalComposition => {
  const logger = options.logger ?? createLogger({ level: config.logLevel, bindings: { component: 'portal-composition' } });
  const registry = new PortalModuleRegistry(logger.child({ component: 'module-registry' }));
  for (const module of options.modules ?? []) registry.registerDefinition(module);
  const catalog = registry.finalize();
  const runtime = createPortalRuntime(config, { moduleMigrations: catalog.migrations });
  const metrics = new PortalMetrics();
  const application = runtime.storage
    ? new PortalApplication({ storage: runtime.storage, ephemeral: runtime.ephemeral, logger, registry, moduleCatalog: catalog, metrics, capabilities: new Set([...DEFAULT_MODULE_CAPABILITIES, ...(config.piiEncryptionKey ? ['pii.read', 'pii.write'] : [])]), ...(config.piiEncryptionKey ? { modulePiiFactory: createModulePiiFactory(config.piiEncryptionKey) } : {}) })
    : undefined;
  if ((options.modules?.length ?? 0) > 0 && !application) {
    void runtime.close();
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модули требуют адаптер долговременного хранилища.');
  }
  return {
    config,
    logger,
    runtime,
    application,
    catalog,
    httpContent: createModuleHttpContent(catalog),
    callbackDefinitions: moduleCallbackDefinitions(catalog),
    commands: moduleCommands(catalog),
    metrics,
    async close() { await runtime.close(); },
  };
};
