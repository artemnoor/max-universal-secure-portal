import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AppError,
  ConfigError,
  ERROR_CODES,
  errorToLogFields,
  errorToPublicPayload,
} from '../../src/core/errors.js';

test('AppError maps to a stable public payload and safe log fields', () => {
  const error = new AppError(ERROR_CODES.AUTH_INVALID, 401, undefined, {
    details: { provider: 'max', requestId: 'request-1' },
    cause: new Error('private provider detail'),
  });

  assert.deepEqual(error.toPublicPayload('request-1'), {
    error: { code: 'AUTH_INVALID', message: 'Не удалось подтвердить авторизацию.' },
    requestId: 'request-1',
  });
  assert.deepEqual(errorToLogFields(error), {
    errorCode: 'AUTH_INVALID',
    status: 401,
    safeMessage: 'Не удалось подтвердить авторизацию.',
    details: { provider: 'max', requestId: 'request-1' },
  });
});

test('unknown errors never expose their internal message to clients', () => {
  const payload = errorToPublicPayload(new Error('database password=secret'), 'request-2');

  assert.deepEqual(payload, {
    error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервиса.' },
    requestId: 'request-2',
  });
});

test('generic error log fields redact credential-shaped details and bound length', () => {
  const fields = errorToLogFields(new Error('postgresql://db.example/portal password=secret token=raw-token'));
  assert.equal(fields.errorName, 'Error');
  assert.doesNotMatch(String(fields.errorMessage), /password@db|secret|raw-token/u);
  assert.ok(String(fields.errorMessage).length <= 512);
});

test('ConfigError identifies a safe configuration key without echoing secret input', () => {
  const error = new ConfigError('BOT_TOKEN', 'production', 'is required');

  assert.equal(error.code, 'CONFIG_INVALID');
  assert.equal(error.status, 500);
  assert.ok(!error.message.includes('real-secret-token'));
  assert.deepEqual(error.toLogFields().details, {
    key: 'BOT_TOKEN',
    environment: 'production',
    reason: 'is required',
  });
});
