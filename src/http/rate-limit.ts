import { createHash } from 'node:crypto';

import { AppError, ERROR_CODES } from '../core/errors.js';
import type { PortalMetrics } from '../observability/metrics.js';
import type { EphemeralStore } from '../portal/ports/ephemeral.js';

export type HttpRateLimitScope = 'ip' | 'principal';

export type HttpRateLimiterOptions = Readonly<{
  maxRequests?: number;
  windowSeconds?: number;
  salt?: string;
  metrics?: PortalMetrics;
}>;

export type HttpRateLimiter = (scope: HttpRateLimitScope, value: string) => Promise<void>;

const boundedInteger = (value: number, name: string, min: number, max: number): number => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, `${name} имеет недопустимое значение.`);
  }
  return value;
};

const digest = (salt: string, value: string): string => createHash('sha256')
  .update(`${salt}:${value}`)
  .digest('hex')
  .slice(0, 32);

export const createHttpRateLimiter = (
  store: EphemeralStore,
  options: HttpRateLimiterOptions = {},
): HttpRateLimiter => {
  const maxRequests = boundedInteger(options.maxRequests ?? 120, 'HTTP rate limit', 1, 10_000);
  const windowSeconds = boundedInteger(options.windowSeconds ?? 60, 'HTTP rate window', 1, 86_400);
  const salt = options.salt ?? 'portal-http-rate-limit';
  if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(salt)) {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'HTTP rate limit salt имеет недопустимое значение.');
  }

  return async (scope, value): Promise<void> => {
    if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(value)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Идентификатор rate limit имеет недопустимый формат.');
    }
    const count = await store.incrementWindow(`http:${scope}:${digest(salt, value)}`, windowSeconds);
    if (count > maxRequests) {
      options.metrics?.increment('rate_limits_total', { status: 'rejected' });
      throw new AppError(ERROR_CODES.RATE_LIMITED, 429, 'Слишком много запросов. Попробуйте позже.');
    }
  };
};
