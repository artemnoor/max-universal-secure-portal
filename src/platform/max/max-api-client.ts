import { randomUUID } from 'node:crypto';

import { AppError, errorToLogFields, ERROR_CODES } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import type { PortalMetrics } from '../../observability/metrics.js';
import { MaxOutboundRateLimiter } from './rate-limiter.js';

export type MaxApiRequest = Readonly<{
  operation: string;
  correlationId?: string;
  run: (signal: AbortSignal) => Promise<unknown>;
  idempotent?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
}>;

export type MaxApiClientOptions = Readonly<{
  limiter?: MaxOutboundRateLimiter;
  logger?: Logger;
  metrics?: PortalMetrics;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}>;

const transientNetworkCodes = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const retryable = (error: unknown): boolean => {
  if (error instanceof AppError) return error.code === ERROR_CODES.DEPENDENCY_UNAVAILABLE;
  if (!error || typeof error !== 'object') return false;
  const record = error as { status?: unknown; code?: unknown; cause?: unknown };
  const cause = record.cause && typeof record.cause === 'object'
    ? record.cause as { code?: unknown }
    : undefined;
  return record.status === 429 || record.status === 502 || record.status === 503 || record.status === 504
    || (typeof record.code === 'string' && transientNetworkCodes.has(record.code))
    || (typeof cause?.code === 'string' && transientNetworkCodes.has(cause.code));
};

export class MaxApiClient {
  private readonly limiter: MaxOutboundRateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: MaxApiClientOptions = {}) {
    this.limiter = options.limiter ?? new MaxOutboundRateLimiter();
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  async request<T>(request: MaxApiRequest): Promise<T> {
    const maxAttempts = request.maxAttempts ?? 3;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Число попыток MAX API недействительно.');
    if (maxAttempts > 1 && request.idempotent !== true) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Повтор разрешён только для идемпотентной операции.');

    const operation = safeOperation(request.operation);
    const correlationId = request.correlationId && /^[A-Za-z0-9_.:-]{1,64}$/u.test(request.correlationId)
      ? request.correlationId
      : randomUUID();
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 5000);
      const startedAt = Date.now();
      try {
        await this.limiter.acquire();
        this.options.metrics?.increment('max_api_requests_total', { operation });
        const result = await request.run(controller.signal);
        this.options.metrics?.observe('max_api_latency_ms', Date.now() - startedAt, { operation });
        return result as T;
      } catch (error) {
        lastError = error;
        if (error instanceof AppError && error.code === ERROR_CODES.RATE_LIMITED) throw error;
        if (isStatus(error, 429)) this.options.metrics?.increment('max_api_429_total', { operation });
        this.options.metrics?.observe('max_api_latency_ms', Date.now() - startedAt, { operation });
        const canRetry = retryable(error);
        if (!canRetry || attempt === maxAttempts) {
          if (canRetry && attempt === maxAttempts) {
            this.options.logger?.error({ operation, correlationId, attempt, error: errorToLogFields(error) }, 'MAX API retries exhausted');
          }
          break;
        }
        const baseBackoff = 100 * (2 ** (attempt - 1)) + Math.floor(this.random() * 100);
        const retryAfterMs = error && typeof error === 'object' && Number.isFinite((error as { retryAfterMs?: unknown }).retryAfterMs)
          ? Number((error as { retryAfterMs: number }).retryAfterMs)
          : 0;
        const backoff = Math.min(2000, Math.max(baseBackoff, retryAfterMs));
        this.options.logger?.warn({ operation, correlationId, attempt, backoffMs: backoff, error: errorToLogFields(error) }, 'retryable MAX API error');
        await this.sleep(backoff);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new AppError(ERROR_CODES.DEPENDENCY_UNAVAILABLE, 503, 'MAX API временно недоступен.', { cause: lastError });
  }
}

const isStatus = (error: unknown, status: number): boolean => Boolean(
  error && typeof error === 'object' && (error as { status?: unknown }).status === status,
);

const safeOperation = (operation: string): string => {
  const normalized = operation.replace(/[^A-Za-z0-9_.:-]/gu, '_').slice(0, 64);
  return normalized || 'unknown';
};

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

const operationPath = (input: RequestInfo | URL): string => {
  try {
    const pathname = new URL(requestUrl(input)).pathname || '/';
    const normalized = pathname.split('/').map((part) => {
      if (/^\d+$/u.test(part) || /^[A-Za-z0-9_-]{16,}$/u.test(part)) return ':id';
      return part;
    }).join('/');
    return normalized.slice(0, 24).replace(/[^A-Za-z0-9_.:-]/gu, '_');
  } catch {
    return 'unknown';
  }
};

const retryableStatuses = new Set([429, 502, 503, 504]);

/** Keep an untrusted MAX response from being buffered without a hard bound by the SDK. */
export const MAX_API_RESPONSE_BYTES = 1 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 2_000;

const retryAfterMilliseconds = (response: Response): number | undefined => {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - Date.now()));
};

const readBoundedResponse = async (response: Response): Promise<Response> => {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_API_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('MAX API response is too large.');
  }
  if (!response.body) return response;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_API_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('MAX API response is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

/**
 * Applies the shared rate/retry/timeout policy to every MAX Bot API request
 * made by the pinned SDK. Non-GET operations are deliberately never retried.
 */
export const createMaxApiFetch = (
  client: MaxApiClient,
  fetcher: typeof fetch = globalThis.fetch,
): typeof fetch => async (input, init = {}) => {
  const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const operation = `max.${method}.${operationPath(input)}`;
  return client.request<Response>({
    operation,
    idempotent: method === 'GET',
    maxAttempts: method === 'GET' ? 3 : 1,
    timeoutMs: 5_000,
    run: async (signal) => {
      const combinedSignal = init.signal ? AbortSignal.any([init.signal, signal]) : signal;
      try {
        const response = await fetcher(input, { ...init, signal: combinedSignal });
        if (retryableStatuses.has(response.status)) {
          const retryAfterMs = retryAfterMilliseconds(response);
          await response.body?.cancel().catch(() => undefined);
          throw Object.assign(new Error(`MAX API returned ${response.status}`), {
            status: response.status,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          });
        }
        return readBoundedResponse(response);
      } catch (error) {
        if (signal.aborted && !init.signal?.aborted) {
          throw Object.assign(new Error('MAX API request timed out.'), { code: 'ETIMEDOUT', cause: error });
        }
        throw error;
      }
    },
  });
};
