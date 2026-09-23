import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { errorToLogFields } from './core/errors.js';
import { createLogger } from './core/logger.js';
import { createPortalComposition } from './entrypoints/composition.js';
import { createWebHost } from './hosts/web-host.js';
import { installProcessLifecycle } from './runtime/process-lifecycle.js';

export type PortalServerHandle = Readonly<ReturnType<typeof createWebHost>>;

export const startPortalServer = async (): Promise<PortalServerHandle> => {
  const logger = createLogger({ level: config.logLevel, bindings: { component: 'portal-http-entrypoint' } });
  const composition = createPortalComposition(config, { logger });
  const host = createWebHost(composition);
  installProcessLifecycle({ logger, stop: () => host.stop(), metrics: composition.metrics });
  try {
    await host.start();
    return host;
  } catch (error) {
    await host.stop().catch((closeError: unknown) => logger.error({ error: errorToLogFields(closeError) }, 'failed to close portal web host'));
    throw error;
  }
};

const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMainModule) void startPortalServer().catch((error: unknown) => {
  createLogger({ level: 'error', bindings: { component: 'portal-http-entrypoint' } }).fatal({ error: errorToLogFields(error) }, 'failed to start portal web host');
  process.exitCode = 1;
});
