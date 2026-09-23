import { buildAuthHeaders } from './auth.js';

export class ApiError extends Error {
  constructor(message, { code = 'INTERNAL_ERROR', status = 500, requestId = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export function toClientErrorMessage(error, fallback = 'Не удалось выполнить действие.') {
  return error instanceof ApiError ? error.message : fallback;
}

const messages = {
  AUTH_REQUIRED: 'Открой приложение из MAX.',
  AUTH_INVALID: 'Не удалось подтвердить авторизацию.',
  AUTH_EXPIRED: 'Сессия устарела. Открой приложение заново.',
  FORBIDDEN: 'У тебя нет доступа к этой операции.',
  RATE_LIMITED: 'Слишком много запросов. Попробуй чуть позже.',
  VALIDATION_FAILED: 'Проверь данные и попробуй ещё раз.',
  DEPENDENCY_UNAVAILABLE: 'Сервис временно недоступен. Попробуй позже.',
  INTERNAL_ERROR: 'Не удалось выполнить запрос. Попробуй ещё раз.',
};

export function getMaxBridge() {
  return window.WebApp || null;
}

export async function api(path, options = {}) {
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.includes('://')) throw new Error('Недопустимый API-маршрут.');
  const parsedPath = new URL(path, location.origin);
  const normalizedPath = parsedPath.pathname.startsWith('/api/v1/') ? parsedPath.pathname : parsedPath.pathname.replace(/^\/api\//u, '/api/v1/');
  parsedPath.searchParams.delete('initData');
  parsedPath.searchParams.delete('userId');
  parsedPath.searchParams.delete('role');
  const body = typeof options.body === 'string' ? (() => {
    try {
      const value = JSON.parse(options.body);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return options.body;
      delete value.initData;
      delete value.userId;
      delete value.role;
      return JSON.stringify(value);
    } catch {
      return options.body;
    }
  })() : options.body;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    const response = await fetch(`${normalizedPath}${parsedPath.search}`, {
      ...options,
      body,
      signal,
      headers: {
        ...(options.headers || {}),
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...buildAuthHeaders(),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    const error = data?.error || {};
    const code = typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR';
    const requestId = typeof data?.requestId === 'string' ? data.requestId : '';
    throw new ApiError(messages[code] || messages.INTERNAL_ERROR, { code, status: response.status, requestId });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === 'AbortError') throw new ApiError('Запрос занял слишком много времени. Попробуй ещё раз.', { code: 'TIMEOUT', status: 408 });
    throw new ApiError(messages.INTERNAL_ERROR, { code: 'NETWORK_ERROR', status: 0 });
  } finally {
    clearTimeout(timeout);
  }
}
