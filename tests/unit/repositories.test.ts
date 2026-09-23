import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError, ERROR_CODES } from '../../src/core/errors.js';
import { createPostgresClientFromPool, type SqlQueryResult } from '../../src/infrastructure/postgres/client.js';
import { createPostgresStorage } from '../../src/infrastructure/postgres/repositories.js';
import {
  assertConversationStateSize,
  assertOwnedItemId,
  MAX_CONVERSATION_STATE_BYTES,
} from '../../src/portal/ports/storage.js';

const principal = { userId: 42, role: 'user' as const };

test('storage boundaries reject oversized conversation state and unsafe item ids', () => {
  assert.throws(
    () => assertConversationStateSize({ text: 'x'.repeat(MAX_CONVERSATION_STATE_BYTES) }),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.VALIDATION_FAILED,
  );
  assert.throws(() => assertOwnedItemId('resource id with spaces'));
  assert.doesNotThrow(() => assertOwnedItemId('resource-09.03.01'));
});

test('PostgreSQL repository scopes user writes to the authenticated principal', async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const query = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> => {
      calls.push({ text, values });
      if (text.includes('RETURNING user_id, chat_id')) {
        return {
          rowCount: 1,
          rows: [{
            user_id: 42,
            chat_id: null,
            first_name: 'Fixture',
            last_name: null,
            username: null,
            role: 'user',
            phone_ciphertext: null,
            phone_nonce: null,
            phone_auth_tag: null,
            phone_key_version: null,
            location_ciphertext: null,
            location_nonce: null,
            location_auth_tag: null,
            location_key_version: null,
            created_at: '2026-09-23T00:00:00.000Z',
            updated_at: '2026-09-23T00:00:00.000Z',
          }] as unknown as Row[],
        };
      }
      return { rowCount: 0, rows: [] };
  };
  const pool = {
    query,
    async connect() {
      return {
        query,
        release() {},
      };
    },
    async end() {},
  };

  const client = createPostgresClientFromPool(pool);
  const storage = createPostgresStorage(client);
  const user = await storage.users.upsert(principal, { firstName: 'Fixture' });

  assert.equal(user.userId, 42);
  const write = calls.find((call) => call.text.includes('INSERT INTO portal_users'));
  assert.ok(write);
  assert.equal(write.values[0], 42);
  assert.equal(write.values.includes('other-user'), false);
  assert.match(write.text, /WHERE|ON CONFLICT/);
});

test('storage transaction rolls back on domain failure', async () => {
  const commands: string[] = [];
  const query = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
  ): Promise<SqlQueryResult<Row>> => {
      commands.push(text.trim());
      return { rowCount: 0, rows: [] };
  };
  const pool = {
    query,
    async connect() {
      return {
        query,
        release() {},
      };
    },
    async end() {},
  };
  const storage = createPostgresStorage(createPostgresClientFromPool(pool));

  await assert.rejects(
    storage.withTransaction(async () => {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'fixture failure');
    }),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.VALIDATION_FAILED,
  );

  assert.deepEqual(commands, ['BEGIN', 'ROLLBACK']);
});
