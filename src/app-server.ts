import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { errorToLogFields } from './core/errors.js';
import { createLogger } from './core/logger.js';
import { buildHttpApp } from './http/app.js';
import { createPortalRuntime } from './infrastructure/runtime/portal-runtime.js';
import { createHttpRateLimiter } from './http/rate-limit.js';
import { PortalMetrics } from './observability/metrics.js';

export type PortalServerHandle = Readonly<{ server: Server; metrics: PortalMetrics; stop(): Promise<void> }>;
export const startPortalServer = async (): Promise<PortalServerHandle> => {
  const logger = createLogger({ level: config.logLevel, bindings: { component: 'portal-http-entrypoint' } });
  const runtime = createPortalRuntime(config);
  const metrics = new PortalMetrics();
  const app = buildHttpApp({ config, store: runtime.store, logger, readiness: runtime.readiness, metrics, rateLimiter: createHttpRateLimiter(runtime.ephemeral, { metrics }) });
  const server = createServer((request, response) => { void app.handler(request, response); });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000;
  try {
    await runtime.readiness();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.appPort, () => { server.off('error', reject); logger.info({ port: config.appPort, origin: config.publicAppOrigins[0] }, 'Portal HTTP server started'); resolve(); }); });
  } catch (error) { await runtime.close().catch((closeError: unknown) => logger.error({ error: errorToLogFields(closeError) }, 'failed to close portal runtime')); throw error; }
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return; stopping = true; logger.info({}, 'portal HTTP shutdown started');
    await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); });
    await runtime.close(); logger.info({}, 'portal HTTP shutdown completed');
  };
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
  return { server, metrics, stop };
};
const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMainModule) void startPortalServer().catch((error: unknown) => { createLogger({ level: 'error', bindings: { component: 'portal-http-entrypoint' } }).fatal({ error: errorToLogFields(error) }, 'failed to start portal HTTP server'); process.exitCode = 1; });
