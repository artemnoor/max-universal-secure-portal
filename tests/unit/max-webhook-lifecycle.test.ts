import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../src/core/errors.js';
import { createLogger } from '../../src/core/logger.js';
import { assertNoConflictingWebhookSubscriptions, createMaxBot, normalizeMaxApiBaseUrl } from '../../src/platform/max/create-max-bot.js';

test('MAX startup accepts an empty list or the configured Webhook URL', () => {
  assert.doesNotThrow(() => assertNoConflictingWebhookSubscriptions([], 'https://staging.example.com/max/webhook'));
  assert.doesNotThrow(() => assertNoConflictingWebhookSubscriptions(
    [{ url: 'https://staging.example.com/max/webhook' }],
    'https://staging.example.com/max/webhook',
  ));
});

test('MAX SDK base URL keeps a configured path segment', () => {
  assert.equal(normalizeMaxApiBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1/');
  assert.equal(normalizeMaxApiBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1/');
});

test('MAX adapter rejects unsafe API base URLs before constructing the SDK', () => {
  assert.throws(
    () => createMaxBot({
      config: {
        botToken: 'fixture-bot-token',
        transport: 'polling',
        webhookDomain: 'staging.example.com',
        webhookPort: 3000,
        webhookPath: '/max/webhook',
        webhookSecret: 'fixture-secret_123',
        maxApiBaseUrl: 'https://user:password@api.example.com',
      },
      logger: createLogger({ level: 'silent' }),
      onEvent: async () => undefined,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID',
  );
});

test('MAX adapter rejects unsafe Webhook domains before constructing the SDK', () => {
  assert.throws(
    () => createMaxBot({
      config: {
        botToken: 'fixture-bot-token',
        transport: 'webhook',
        webhookDomain: 'bot.example.com@evil.example',
        webhookPort: 3000,
        webhookPath: '/max/webhook',
        webhookSecret: 'fixture-secret_123',
      },
      logger: createLogger({ level: 'silent' }),
      onEvent: async () => undefined,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID',
  );
});

test('MAX startup fails closed instead of deleting another environment subscription', () => {
  assert.throws(
    () => assertNoConflictingWebhookSubscriptions(
      [{ url: 'https://production.example.com/max/webhook' }],
      'https://staging.example.com/max/webhook',
    ),
    (error: unknown) => error instanceof AppError
      && error.code === 'CONFIG_INVALID'
      && !error.message.includes('production.example.com'),
  );
});

test('MAX startup rejects malformed subscription records without echoing values', () => {
  assert.throws(
    () => assertNoConflictingWebhookSubscriptions([{ url: 42 }], 'https://staging.example.com/max/webhook'),
    (error: unknown) => error instanceof AppError && error.code === 'CONFIG_INVALID' && !error.message.includes('42'),
  );
});

test('graceful MAX shutdown does not delegate to the SDK Webhook stop that deletes subscriptions', async () => {
  const adapter = createMaxBot({
    config: {
      botToken: 'fixture-bot-token',
      transport: 'webhook',
      webhookDomain: 'staging.example.com',
      webhookPort: 3000,
      webhookPath: '/max/webhook',
      webhookSecret: 'fixture-secret_123',
    },
    logger: createLogger({ level: 'silent' }),
    onEvent: async () => undefined,
  });
  let sdkStopWebhookCalled = false;
  adapter.bot.stopWebhook = async () => { sdkStopWebhookCalled = true; };

  await adapter.stop();

  assert.equal(sdkStopWebhookCalled, false);
});

test('MAX polling startup does not clear Webhook subscriptions through the SDK wrapper', async () => {
  const adapter = createMaxBot({
    config: {
      botToken: 'fixture-bot-token',
      transport: 'polling',
      webhookDomain: 'staging.example.com',
      webhookPort: 3000,
      webhookPath: '/max/webhook',
      webhookSecret: 'fixture-secret_123',
    },
    logger: createLogger({ level: 'silent' }),
    onEvent: async () => undefined,
  });
  let destructiveStartCalled = false;
  let pollingStartCalled = false;
  adapter.bot.api.getMyInfo = async () => ({ user_id: 1, username: 'fixture-bot' } as never);
  adapter.bot.start = async () => { destructiveStartCalled = true; };
  adapter.bot.startPolling = async () => { pollingStartCalled = true; };

  await adapter.start();

  assert.equal(destructiveStartCalled, false);
  assert.equal(pollingStartCalled, true);
});
