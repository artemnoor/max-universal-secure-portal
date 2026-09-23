import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AppConfig } from '../../core/config.js';
import { AppError, ERROR_CODES } from '../../core/errors.js';
import { staticContentSecurityPolicy } from '../static-policy.js';

export const requestId = (request: IncomingMessage): string => {
  const candidate = request.headers['x-request-id'];
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value
    : randomUUID();
};

export const applySecurityHeaders = (
  response: ServerResponse,
  config: Pick<AppConfig, 'isProduction' | 'publicAppOrigins'>,
  origin?: string,
  isStatic = false,
): void => {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(self)',
    'cache-control': isStatic ? 'no-store' : 'no-store',
    'content-security-policy': staticContentSecurityPolicy(config.publicAppOrigins),
  };
  if (config.isProduction) headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  if (origin && config.publicAppOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  response.setHeader('vary', headers.vary ?? 'Origin');
  for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
};

export const assertJsonContentType = (request: IncomingMessage): void => {
  const contentType = request.headers['content-type'];
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  if (!value?.toLowerCase().startsWith('application/json')) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 415, 'Ожидается JSON-запрос.');
};

export const rejectQueryAuth = (url: URL): void => {
  if (url.searchParams.has('initData') || url.searchParams.has('userId') || url.searchParams.has('role')) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Авторизация передаётся только заголовком.');
};
