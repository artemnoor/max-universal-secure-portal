import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError, ERROR_CODES } from '../../src/core/errors.js';
import { FileStore } from '../../src/infrastructure/dev/file-store.js';
import { Store } from '../../src/store.js';

test('FileStore fails closed when explicitly disabled', () => {
  assert.throws(
    () => new Store('.data-test-only', { allowFileStore: false }),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.CONFIG_INVALID,
  );
});

test('FileStore is explicitly development-only', () => {
  const originalEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => new FileStore('.data-test-only'), AppError);
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
});

test('FileStore is refused when DATABASE_URL is configured', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://db.example/portal';
  try {
    assert.throws(
      () => new FileStore('.data-test-only'),
      (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.CONFIG_INVALID,
    );
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});
