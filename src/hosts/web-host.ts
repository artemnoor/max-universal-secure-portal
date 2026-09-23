import { createServer, type Server } from 'node:http';
import type { HostLifecycle, PortalComposition } from '../runtime/host-contracts.js';
import { buildHttpApp } from '../http/app.js';
import { createHttpRateLimiter } from '../http/rate-limit.js';

export type WebHost = HostLifecycle & Readonly<{ server: Server }>;

export const createWebHost = (composition: PortalComposition): WebHost => {
  const logger = composition.logger.child({ component: 'portal-web-host' });
  const app = buildHttpApp({
    config: composition.config,
    content: composition.httpContent,
    portalInfo: composition.portalInfo,
    store: composition.runtime.store,
    logger,
    readiness: composition.runtime.readiness,
    metrics: composition.metrics,
    rateLimiter: createHttpRateLimiter(composition.runtime.ephemeral, { metrics: composition.metrics }),
  });
  const server = createServer((request, response) => { void app.handler(request, response); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  let started = false;
  let stopped = false;
  return {
    server,
    async start() {
      if (started) return;
      await composition.runtime.readiness();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(composition.config.appPort, () => {
          server.off('error', reject);
          resolve();
        });
      });
      started = true;
      logger.info({ port: composition.config.appPort }, 'Portal web host started');
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await composition.close();
      logger.info({}, 'Portal web host stopped');
    },
  };
};
