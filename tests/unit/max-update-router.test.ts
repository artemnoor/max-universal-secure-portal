import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../src/core/errors.js';
import { normalizeMaxUpdate } from '../../src/platform/max/update-router.js';

const user = { user_id: 42, first_name: 'Fixture', username: 'fixture_user' };

test('MAX update router normalizes message, callback and lifecycle events', () => {
  const message = normalizeMaxUpdate({
    updateType: 'message_created',
    update: {
      update_type: 'message_created',
      timestamp: 100,
      message: {
        sender: user,
        recipient: { chat_id: 77 },
        body: { mid: 'm-1', text: 'hello', attachments: [{ type: 'audio', payload: { token: 'opaque' } }] },
      },
    },
  }, { now: () => new Date('2026-01-01T00:00:00.000Z') });
  assert.equal(message?.kind, 'message');
  assert.equal(message?.principal.userId, 42);
  assert.equal(message?.chatId, 77);
  assert.equal((message?.payload as { text: string }).text, 'hello');
  assert.deepEqual((message?.payload as { attachments: unknown[] }).attachments, [{ type: 'audio', hasAudioToken: true }]);

  const callback = normalizeMaxUpdate({
    updateType: 'message_callback',
    update: {
      update_type: 'message_callback',
      timestamp: 101,
      callback: { callback_id: 'cb-1', payload: 'module:run', user },
      message: { body: { mid: 'm-1' }, recipient: { chat_id: 77 } },
    },
  });
  assert.equal(callback?.kind, 'callback');
  assert.equal((callback?.payload as { payload: string }).payload, 'module:run');

  const lifecycle = normalizeMaxUpdate({
    updateType: 'bot_added',
    update: { update_type: 'bot_added', timestamp: 102, chat_id: 77, user, is_channel: false },
  });
  assert.equal(lifecycle?.kind, 'lifecycle');
  assert.equal(lifecycle?.principal.chatId, 77);
});

test('MAX update router rejects malformed and oversized untrusted fields', () => {
  assert.throws(
    () => normalizeMaxUpdate({ updateType: 'message_created', update: { update_type: 'message_created', message: { body: { text: 'x'.repeat(8193) }, sender: user } } }),
    (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_FAILED',
  );

  assert.throws(
    () => normalizeMaxUpdate({ updateType: 'message_callback', update: { update_type: 'message_callback', callback: { user, payload: 'x'.repeat(1025) } } }),
    (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_FAILED',
  );

  assert.equal(normalizeMaxUpdate({ updateType: 'unknown', update: { update_type: 'unknown', user } }), undefined);
  assert.throws(
    () => normalizeMaxUpdate({ updateType: 'message_created', update: { update_type: 'message_created', message: { body: { text: 'x' } } } }),
    (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_FAILED',
  );
});

test('MAX update event identity remains bounded when an external id is oversized', () => {
  const event = normalizeMaxUpdate({
    updateType: 'message_created',
    update: {
      update_type: 'message_created',
      timestamp: 100,
      message: { sender: user, body: { mid: 'm'.repeat(1_000_000), text: 'hello' } },
    },
  });
  assert.match(event?.eventId ?? '', /^max_[a-f0-9]{32}$/u);
});
