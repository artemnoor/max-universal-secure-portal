import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { PortalPrincipal } from '../../core/principal.js';
import type {
  AuditEventInput,
  AuditRepository,
  ConversationStateRecord,
  ConversationStateRepository,
  EncryptedPii,
  ImportMarkerRepository,
  ImportMarker,
  PortalUser,
  SavedItem,
  SavedItemBucket,
  SavedItemKind,
  SavedItemRepository,
  StoragePort,
  UpdateInboxRepository,
  UpdateInboxReserveOptions,
  UpdateInboxReservation,
  UserProfilePatch,
  UserRepository,
} from '../../portal/ports/storage.js';
import { assertConversationStateSize, assertOwnedItemId, assertItemBucket, assertItemKind } from '../../portal/ports/storage.js';
import type { PostgresClient, SqlExecutor } from './client.js';

type DbRow = Record<string, unknown>;

type DbUserRow = DbRow & {
  user_id: number | string;
  chat_id: number | string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  role: 'user' | 'admin';
  phone_ciphertext: string | null;
  phone_nonce: string | null;
  phone_auth_tag: string | null;
  phone_key_version: number | null;
  location_ciphertext: string | null;
  location_nonce: string | null;
  location_auth_tag: string | null;
  location_key_version: number | null;
  created_at: string | Date;
  updated_at: string | Date;
};

const userIdOf = (principal: PortalPrincipal): number => principal.userId;
const asDate = (value: string | Date): Date => value instanceof Date ? value : new Date(value);
const asOptionalNumber = (value: number | string | null): number | undefined => value === null ? undefined : Number(value);

const encryptedPiiFromRow = (row: DbRow, prefix: 'phone' | 'location'): EncryptedPii | undefined => {
  const ciphertext = row[`${prefix}_ciphertext`];
  const nonce = row[`${prefix}_nonce`];
  const authTag = row[`${prefix}_auth_tag`];
  const keyVersion = row[`${prefix}_key_version`];
  if (typeof ciphertext !== 'string' || typeof nonce !== 'string' || typeof authTag !== 'string' || typeof keyVersion !== 'number') return undefined;
  return { ciphertext, nonce, authTag, keyVersion };
};

const mapUser = (row: DbUserRow): PortalUser => ({
  userId: Number(row.user_id),
  ...(asOptionalNumber(row.chat_id) === undefined ? {} : { chatId: asOptionalNumber(row.chat_id) }),
  ...(row.first_name === null ? {} : { firstName: row.first_name }),
  ...(row.last_name === null ? {} : { lastName: row.last_name }),
  ...(row.username === null ? {} : { username: row.username }),
  role: row.role,
  ...(encryptedPiiFromRow(row, 'phone') ? { phone: encryptedPiiFromRow(row, 'phone') } : {}),
  ...(encryptedPiiFromRow(row, 'location') ? { location: encryptedPiiFromRow(row, 'location') } : {}),
  createdAt: asDate(row.created_at),
  updatedAt: asDate(row.updated_at),
});

const encryptedValues = (value: EncryptedPii | undefined): Array<string | number | null> => [
  value?.ciphertext ?? null,
  value?.nonce ?? null,
  value?.authTag ?? null,
  value?.keyVersion ?? null,
];

const rowOrUndefined = <Row extends DbRow>(rows: Row[]): Row | undefined => rows[0];

const createUserRepository = (executor: SqlExecutor): UserRepository => ({
  async get(principal) {
    const result = await executor.query<DbUserRow>(
      `SELECT user_id, chat_id, first_name, last_name, username, role,
              phone_ciphertext, phone_nonce, phone_auth_tag, phone_key_version,
              location_ciphertext, location_nonce, location_auth_tag, location_key_version,
              created_at, updated_at
         FROM portal_users
        WHERE user_id = $1`,
      [userIdOf(principal)],
    );
    const row = rowOrUndefined(result.rows);
    return row ? mapUser(row) : undefined;
  },

  async upsert(principal, profile) {
    const result = await executor.query<DbUserRow>(
      `INSERT INTO portal_users (
         user_id, chat_id, first_name, last_name, username, role,
         phone_ciphertext, phone_nonce, phone_auth_tag, phone_key_version,
         location_ciphertext, location_nonce, location_auth_tag, location_key_version
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (user_id) DO UPDATE SET
         chat_id = COALESCE(EXCLUDED.chat_id, portal_users.chat_id),
         first_name = COALESCE(EXCLUDED.first_name, portal_users.first_name),
         last_name = COALESCE(EXCLUDED.last_name, portal_users.last_name),
         username = COALESCE(EXCLUDED.username, portal_users.username),
         role = CASE WHEN portal_users.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END,
         phone_ciphertext = COALESCE(EXCLUDED.phone_ciphertext, portal_users.phone_ciphertext),
         phone_nonce = COALESCE(EXCLUDED.phone_nonce, portal_users.phone_nonce),
         phone_auth_tag = COALESCE(EXCLUDED.phone_auth_tag, portal_users.phone_auth_tag),
         phone_key_version = COALESCE(EXCLUDED.phone_key_version, portal_users.phone_key_version),
         location_ciphertext = COALESCE(EXCLUDED.location_ciphertext, portal_users.location_ciphertext),
         location_nonce = COALESCE(EXCLUDED.location_nonce, portal_users.location_nonce),
         location_auth_tag = COALESCE(EXCLUDED.location_auth_tag, portal_users.location_auth_tag),
         location_key_version = COALESCE(EXCLUDED.location_key_version, portal_users.location_key_version),
         updated_at = NOW()
       RETURNING user_id, chat_id, first_name, last_name, username, role,
                 phone_ciphertext, phone_nonce, phone_auth_tag, phone_key_version,
                 location_ciphertext, location_nonce, location_auth_tag, location_key_version,
                 created_at, updated_at`,
      [
        userIdOf(principal),
        profile.chatId ?? null,
        profile.firstName ?? null,
        profile.lastName ?? null,
        profile.username ?? null,
        principal.role,
        ...encryptedValues(profile.phone),
        ...encryptedValues(profile.location),
      ],
    );
    const row = rowOrUndefined(result.rows);
    if (!row) throw new AppError(ERROR_CODES.INTERNAL_ERROR, 500, 'Не удалось сохранить профиль пользователя.');
    return mapUser(row);
  },
});

const createConversationStateRepository = (executor: SqlExecutor): ConversationStateRepository => ({
  async get(principal) {
    const result = await executor.query<DbRow>(
      `SELECT user_id, state, version, expires_at, updated_at
         FROM conversation_states
        WHERE user_id = $1
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [userIdOf(principal)],
    );
    const row = rowOrUndefined(result.rows);
    if (!row) return undefined;
    return {
      userId: Number(row.user_id),
      version: Number(row.version),
      state: row.state as Record<string, unknown>,
      ...(row.expires_at ? { expiresAt: asDate(row.expires_at as string | Date) } : {}),
      updatedAt: asDate(row.updated_at as string | Date),
    };
  },

  async save(principal, state, expectedVersion, expiresAt) {
    assertConversationStateSize(state);
    const userId = userIdOf(principal);
    const result = expectedVersion === undefined
      ? await executor.query<DbRow>(
        `INSERT INTO conversation_states (user_id, state, version, expires_at, updated_at)
         VALUES ($1, $2::jsonb, 1, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           state = EXCLUDED.state,
           version = conversation_states.version + 1,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()
         RETURNING user_id, state, version, expires_at, updated_at`,
        [userId, JSON.stringify(state), expiresAt ?? null],
      )
      : await executor.query<DbRow>(
        `UPDATE conversation_states
            SET state = $2::jsonb, version = version + 1, expires_at = $3, updated_at = NOW()
          WHERE user_id = $1 AND version = $4
        RETURNING user_id, state, version, expires_at, updated_at`,
        [userId, JSON.stringify(state), expiresAt ?? null, expectedVersion],
      );

    const row = rowOrUndefined(result.rows);
    if (!row) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 409, 'Состояние диалога уже изменилось. Повторите операцию.');
    }
    return {
      userId: Number(row.user_id),
      version: Number(row.version),
      state: row.state as Record<string, unknown>,
      ...(row.expires_at ? { expiresAt: asDate(row.expires_at as string | Date) } : {}),
      updatedAt: asDate(row.updated_at as string | Date),
    } satisfies ConversationStateRecord;
  },

  async clear(principal) {
    await executor.query('DELETE FROM conversation_states WHERE user_id = $1', [userIdOf(principal)]);
  },
});

const createSavedItemRepository = (executor: SqlExecutor): SavedItemRepository => ({
  async list(principal, kind) {
    const result = await executor.query<DbRow>(
      `SELECT user_id, item_kind, item_id, bucket, created_at
         FROM saved_items
        WHERE user_id = $1 AND ($2::text IS NULL OR item_kind = $2)
        ORDER BY created_at DESC`,
      [userIdOf(principal), kind ?? null],
    );
    return result.rows.map((row) => ({
      userId: Number(row.user_id),
      kind: row.item_kind as SavedItemKind,
      itemId: String(row.item_id),
      bucket: row.bucket as SavedItemBucket,
      createdAt: asDate(row.created_at as string | Date),
    } satisfies SavedItem));
  },

  async save(principal, kind, itemId, bucket = 'default') {
    assertItemKind(kind);
    assertOwnedItemId(itemId);
    assertItemBucket(bucket);
    const result = await executor.query<DbRow>(
      `INSERT INTO saved_items (user_id, item_kind, item_id, bucket)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, item_kind, item_id) DO UPDATE SET bucket = EXCLUDED.bucket
       RETURNING user_id, item_kind, item_id, bucket, created_at`,
      [userIdOf(principal), kind, itemId, bucket],
    );
    const row = rowOrUndefined(result.rows);
    if (!row) throw new AppError(ERROR_CODES.INTERNAL_ERROR, 500, 'Не удалось сохранить элемент.');
    return {
      userId: Number(row.user_id),
      kind: row.item_kind as SavedItemKind,
      itemId: String(row.item_id),
      bucket: row.bucket as SavedItemBucket,
      createdAt: asDate(row.created_at as string | Date),
    } satisfies SavedItem;
  },

  async remove(principal, kind, itemId) {
    assertOwnedItemId(itemId);
    await executor.query(
      'DELETE FROM saved_items WHERE user_id = $1 AND item_kind = $2 AND item_id = $3',
      [userIdOf(principal), kind, itemId],
    );
  },
});

const createAuditRepository = (executor: SqlExecutor): AuditRepository => ({
  async append(event: AuditEventInput) {
    await executor.query(
      `INSERT INTO audit_events (user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [event.principal.userId, event.action, event.resourceType, event.resourceId ?? null, JSON.stringify(event.metadata ?? {})],
    );
  },
});

const createUpdateInboxRepository = (executor: SqlExecutor): UpdateInboxRepository => ({
  async reserve(eventKey, principal, options: UpdateInboxReserveOptions = {}): Promise<UpdateInboxReservation> {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(eventKey)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Идентификатор события имеет недопустимый формат.');
    }
    const inserted = await executor.query(
      `INSERT INTO update_inbox (event_key, user_id, status, attempts)
       VALUES ($1, $2, 'processing', 1)
       ON CONFLICT (event_key) DO NOTHING`,
      [eventKey, principal.userId],
    );
    if (inserted.rowCount > 0) return { eventKey, status: 'processing', duplicate: false };

    const retryFailedAfterSeconds = options.retryFailedAfterSeconds ?? 30;
    if (!Number.isSafeInteger(retryFailedAfterSeconds) || retryFailedAfterSeconds < 0 || retryFailedAfterSeconds > 86400) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Интервал повтора события имеет недопустимое значение.');
    }
    const reclaimed = await executor.query(
      `UPDATE update_inbox
          SET status = 'processing', attempts = attempts + 1, last_seen_at = NOW()
        WHERE event_key = $1
          AND status = 'failed'
          AND last_seen_at <= NOW() - ($2::integer * INTERVAL '1 second')`,
      [eventKey, retryFailedAfterSeconds],
    );
    if (reclaimed.rowCount > 0) return { eventKey, status: 'processing', duplicate: false };

    const claimedReceived = await executor.query(
      `UPDATE update_inbox
          SET status = 'processing', last_seen_at = NOW()
        WHERE event_key = $1 AND status = 'received'`,
      [eventKey],
    );
    if (claimedReceived.rowCount > 0) return { eventKey, status: 'processing', duplicate: false };

    const existing = await executor.query<DbRow>(
      'SELECT event_key, status FROM update_inbox WHERE event_key = $1',
      [eventKey],
    );
    const row = rowOrUndefined(existing.rows);
    if (!row) throw new AppError(ERROR_CODES.INTERNAL_ERROR, 500, 'Не удалось проверить повтор события.');
    return { eventKey, status: row.status as UpdateInboxReservation['status'], duplicate: true };
  },

  async markProcessed(eventKey) {
    await executor.query(
      `UPDATE update_inbox
          SET status = 'processed', processed_at = NOW(), last_seen_at = NOW()
        WHERE event_key = $1`,
      [eventKey],
    );
  },

  async markFailed(eventKey, errorCode) {
    await executor.query(
      `UPDATE update_inbox
          SET status = 'failed', error_code = $2, last_seen_at = NOW()
        WHERE event_key = $1`,
      [eventKey, errorCode],
    );
  },
});

const createImportMarkerRepository = (executor: SqlExecutor): ImportMarkerRepository => ({
  async has(sourceChecksum) {
    const result = await executor.query(
      'SELECT source_checksum FROM import_markers WHERE source_checksum = $1',
      [sourceChecksum],
    );
    return result.rowCount > 0;
  },

  async mark(sourceChecksum, itemCount) {
    const result = await executor.query<DbRow>(
      `INSERT INTO import_markers (source_checksum, item_count)
       VALUES ($1, $2)
       ON CONFLICT (source_checksum) DO UPDATE SET item_count = EXCLUDED.item_count
       RETURNING source_checksum, item_count, imported_at`,
      [sourceChecksum, itemCount],
    );
    const row = rowOrUndefined(result.rows);
    if (!row) throw new AppError(ERROR_CODES.INTERNAL_ERROR, 500, 'Не удалось сохранить marker импорта.');
    return {
      sourceChecksum: String(row.source_checksum),
      itemCount: Number(row.item_count),
      importedAt: asDate(row.imported_at as string | Date),
    } satisfies ImportMarker;
  },
});

const createStorage = (executor: SqlExecutor, client: PostgresClient, canTransact: boolean): StoragePort => ({
  users: createUserRepository(executor),
  conversationStates: createConversationStateRepository(executor),
  savedItems: createSavedItemRepository(executor),
  audit: createAuditRepository(executor),
  updateInbox: createUpdateInboxRepository(executor),
  importMarkers: createImportMarkerRepository(executor),
  async withTransaction<T>(callback: (storage: StoragePort) => Promise<T>) {
    if (!canTransact) return callback(createStorage(executor, client, false));
    return client.withTransaction((transactionExecutor) => callback(createStorage(transactionExecutor, client, false)));
  },
  async close() {
    if (canTransact) await client.close();
  },
});

export const createPostgresStorage = (client: PostgresClient): StoragePort => createStorage(client, client, true);
