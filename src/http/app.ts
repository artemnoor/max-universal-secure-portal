import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { z } from 'zod';

import type { AppConfig } from '../core/config.js';
import { AppError, errorToLogFields, errorToPublicPayload, ERROR_CODES } from '../core/errors.js';
import { createLogger, type Logger } from '../core/logger.js';
import type { PortalPrincipal } from '../core/principal.js';
import type { PortalHttpContent, PortalHttpRoute, PortalHttpRequest } from '../portal/ports/http-content.js';
import type { PortalUserStore } from '../portal/ports/user-store.js';
import { applySecurityHeaders, assertJsonContentType, rejectQueryAuth, requestId } from './middleware/security.js';
import { extractMaxSession, toPortalPrincipal } from './middleware/max-principal.js';
import { checkReadiness } from '../health/readiness.js';
import type { PortalMetrics } from '../observability/metrics.js';
import type { HttpRateLimiter } from './rate-limit.js';

export type HttpAppDependencies = Readonly<{
  config: Pick<AppConfig, 'nodeEnv' | 'isProduction' | 'botToken' | 'initDataTtlSeconds' | 'allowUnverifiedMiniApp' | 'devAllowUnverifiedMiniApp' | 'adminUserIds' | 'publicAppOrigins' | 'webhookPath' | 'webhookSecret'>;
  content?: PortalHttpContent;
  store: PortalUserStore;
  logger?: Logger;
  miniAppRoot?: string;
  webhookHandler?: (request: IncomingMessage, response: ServerResponse) => void;
  readiness?: () => Promise<void>;
  metrics?: PortalMetrics;
  rateLimiter?: HttpRateLimiter;
}>;
export type HttpApp = Readonly<{ handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> }>;
export const MAX_HTTP_RESPONSE_BYTES = 4 * 1024 * 1024;
const BODY_LIMIT = 1_048_576;
const contentTypes: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const header = (request: IncomingMessage, name: string): string | undefined => { const value = request.headers[name]; return Array.isArray(value) ? value[0] : value; };
const readJson = async (request: IncomingMessage): Promise<unknown> => {
  assertJsonContentType(request);
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > BODY_LIMIT) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 413, 'Запрос слишком большой.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)); size += buffer.byteLength; if (size > BODY_LIMIT) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 413, 'Запрос слишком большой.'); chunks.push(buffer); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw) as unknown; } catch (error) { throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Некорректный JSON.', { cause: error }); }
};
const ensureOrigin = (request: IncomingMessage, origins: readonly string[]): string | undefined => { const origin = header(request, 'origin'); if (origin && !origins.includes(origin)) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Источник запроса не разрешён.'); return origin; };
const routeMatches = (route: PortalHttpRoute, method: string, pathname: string): boolean => {
  if (route.method !== method) return false;
  if (typeof route.match === 'string') return route.match === pathname;
  if (route.match instanceof RegExp) { route.match.lastIndex = 0; return route.match.test(pathname); }
  return route.match(method, pathname);
};
const safeRateValue = (value: string): string => value.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 256) || 'unknown';

export const serveStatic = async (response: ServerResponse, pathname: string, root: string, dependencies: Pick<HttpAppDependencies, 'config'>, request: IncomingMessage): Promise<void> => {
  const requested = pathname === '/' ? '/index.html' : pathname;
  if (requested.includes('..') || requested.includes('\0') || requested.split('/').some((part) => part.startsWith('.')) || requested.endsWith('.map')) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Файл недоступен.');
  const filePath = resolve(root, `.${normalize(requested)}`);
  if (!filePath.startsWith(`${root}${sep}`) && filePath !== root) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Файл недоступен.');
  const rootRealPath = await realpath(root); const fileRealPath = await realpath(filePath); const fileInfo = await stat(fileRealPath);
  if (!fileRealPath.startsWith(`${rootRealPath}${sep}`) || !fileInfo.isFile()) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Файл недоступен.');
  applySecurityHeaders(response, dependencies.config, header(request, 'origin'), true);
  response.setHeader('content-type', contentTypes[extname(fileRealPath)] ?? 'application/octet-stream'); response.writeHead(200); createReadStream(fileRealPath).pipe(response);
};

export const buildHttpApp = (dependencies: HttpAppDependencies): HttpApp => {
  const logger = dependencies.logger ?? createLogger({ bindings: { component: 'http' } });
  const miniAppRoot = resolve(dependencies.miniAppRoot ?? 'miniapp');
  return { handler: async (request, response): Promise<void> => {
    const id = requestId(request); const startedAt = Date.now(); const url = new URL(request.url ?? '/', 'http://portal.invalid'); let origin: string | undefined;
    const write = (status: number, payload: unknown, extraHeaders: Readonly<Record<string, string>> = {}): void => {
      if (response.headersSent) return; const body = JSON.stringify(payload); if (Buffer.byteLength(body, 'utf8') > MAX_HTTP_RESPONSE_BYTES) throw new AppError(ERROR_CODES.DEPENDENCY_UNAVAILABLE, 503, 'Ответ сервиса слишком большой.');
      applySecurityHeaders(response, dependencies.config, origin); response.setHeader('x-request-id', id); response.setHeader('content-type', 'application/json; charset=utf-8'); for (const [key, value] of Object.entries(extraHeaders)) response.setHeader(key, value); response.writeHead(status); response.end(body); dependencies.metrics?.increment('http_requests_total', { status: String(status) });
    };
    try {
      origin = ensureOrigin(request, dependencies.config.publicAppOrigins);
      rejectQueryAuth(url);
      if (url.pathname === dependencies.config.webhookPath && dependencies.webhookHandler) { dependencies.webhookHandler(request, response); return; }
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/v1/')) { write(404, { error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Маршрут не найден.', requestId: id } }); return; }
      if (url.pathname === '/api/v1/health' && request.method === 'GET') { write(200, { ok: true, status: 'ready', requestId: id }); return; }
      if (url.pathname === '/health/live' && request.method === 'GET') { write(200, { ok: true, status: 'live', requestId: id }); return; }
      if (url.pathname === '/health/ready' && request.method === 'GET') {
        const readiness = await checkReadiness(dependencies.readiness ? [{ name: 'runtime', check: dependencies.readiness }] : [], logger, dependencies.metrics); write(readiness.ok ? 200 : 503, { ok: readiness.ok, status: readiness.ok ? 'ready' : 'unavailable', requestId: id }); return;
      }
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) { await serveStatic(response, url.pathname, miniAppRoot, dependencies, request); return; }
      if (!url.pathname.startsWith('/api/v1/') || !dependencies.content) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 404, 'Маршрут не найден.');
      const route = dependencies.content.routes().find((candidate) => routeMatches(candidate, request.method ?? '', url.pathname));
      if (!route) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 404, 'Маршрут не найден.');
      let principal: PortalPrincipal | undefined;
      if (route.access !== 'public') {
        const session = extractMaxSession(request, dependencies.config); principal = toPortalPrincipal(session, dependencies.config.adminUserIds);
        if (route.access === 'admin' && principal.role !== 'admin') throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Действие недоступно.');
        await dependencies.rateLimiter?.('principal', String(principal.userId));
        await dependencies.store.recordUser({ userId: principal.userId, ...(session.user?.first_name ? { firstName: session.user.first_name } : {}), ...(session.user?.last_name ? { lastName: session.user.last_name } : {}), ...(session.user?.username ? { username: session.user.username } : {}) });
      } else await dependencies.rateLimiter?.('ip', safeRateValue(request.socket.remoteAddress ?? 'unknown'));
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readJson(request);
      const result = await route.handle({ request, url, body, requestId: id, ...(principal ? { principal } : {}) } satisfies PortalHttpRequest);
      // Module routes return data only. Node owns status, security headers, cookies, redirects and CORS.
      write(200, result.body);
    } catch (error) {
      const safeError = error instanceof z.ZodError ? new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Проверьте данные запроса.', { details: { issueCount: error.issues.length } }) : error;
      const publicPayload = safeError instanceof AppError ? safeError.toPublicPayload(id) : errorToPublicPayload(safeError, id); const status = safeError instanceof AppError ? safeError.status : 500;
      if (safeError instanceof AppError && (safeError.code === ERROR_CODES.AUTH_REQUIRED || safeError.code === ERROR_CODES.AUTH_INVALID || safeError.code === ERROR_CODES.AUTH_EXPIRED)) dependencies.metrics?.increment('auth_failures_total', { errorCode: safeError.code });
      logger.warn({ requestId: id, method: request.method, path: url.pathname, durationMs: Date.now() - startedAt, error: errorToLogFields(safeError) }, 'HTTP request rejected');
      if (status === 429 && !response.headersSent) response.setHeader('retry-after', '60');
      if (!response.headersSent) write(status, publicPayload);
    }
  } };
};
