import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { PortalPrincipal } from '../../core/principal.js';

export const MAX_CONVERSATION_STATE_BYTES = 32 * 1024;

export type EncryptedPii = Readonly<{ ciphertext: string; nonce: string; authTag: string; keyVersion: number }>;
export type UserProfilePatch = Readonly<{ chatId?: number; firstName?: string; lastName?: string; username?: string; phone?: EncryptedPii; location?: EncryptedPii }>;
export type PortalUser = Readonly<{ userId: number; chatId?: number; firstName?: string; lastName?: string; username?: string; role: PortalPrincipal['role']; phone?: EncryptedPii; location?: EncryptedPii; createdAt: Date; updatedAt: Date }>;
export type ConversationStateRecord = Readonly<{ userId: number; version: number; state: Record<string, unknown>; expiresAt?: Date; updatedAt: Date }>;
export type SavedItemKind = string;
export type SavedItemBucket = string;
export type SavedItem = Readonly<{ userId: number; kind: SavedItemKind; itemId: string; bucket: SavedItemBucket; createdAt: Date }>;
export type AuditEventInput = Readonly<{ principal: PortalPrincipal; action: string; resourceType: string; resourceId?: string; moduleId?: string; requestId?: string; occurredAt?: Date; metadata?: Readonly<Record<string, boolean | number | string | null>> }>;
export type UpdateInboxStatus = 'received' | 'processing' | 'processed' | 'failed';
export type UpdateInboxReservation = Readonly<{ eventKey: string; status: UpdateInboxStatus; duplicate: boolean }>;
export type UpdateInboxReserveOptions = Readonly<{ retryFailedAfterSeconds?: number }>;
export type ImportMarker = Readonly<{ sourceChecksum: string; importedAt: Date; itemCount: number }>;

export interface UserRepository { get(principal: PortalPrincipal): Promise<PortalUser | undefined>; upsert(principal: PortalPrincipal, profile: UserProfilePatch): Promise<PortalUser>; }
export interface ConversationStateRepository {
  get(principal: PortalPrincipal): Promise<ConversationStateRecord | undefined>;
  save(principal: PortalPrincipal, state: Record<string, unknown>, expectedVersion?: number, expiresAt?: Date): Promise<ConversationStateRecord>;
  clear(principal: PortalPrincipal): Promise<void>;
}
export interface SavedItemRepository {
  list(principal: PortalPrincipal, kind?: SavedItemKind): Promise<readonly SavedItem[]>;
  save(principal: PortalPrincipal, kind: SavedItemKind, itemId: string, bucket?: SavedItemBucket): Promise<SavedItem>;
  remove(principal: PortalPrincipal, kind: SavedItemKind, itemId: string): Promise<void>;
}
export interface AuditRepository { append(event: AuditEventInput): Promise<void>; }
export interface UpdateInboxRepository {
  reserve(eventKey: string, principal: PortalPrincipal, options?: UpdateInboxReserveOptions): Promise<UpdateInboxReservation>;
  markProcessed(eventKey: string): Promise<void>;
  markFailed(eventKey: string, errorCode: string): Promise<void>;
}
export interface ImportMarkerRepository { has(sourceChecksum: string): Promise<boolean>; mark(sourceChecksum: string, itemCount: number): Promise<ImportMarker>; }
export interface StoragePort {
  readonly users: UserRepository;
  readonly conversationStates: ConversationStateRepository;
  readonly savedItems: SavedItemRepository;
  readonly audit: AuditRepository;
  readonly updateInbox: UpdateInboxRepository;
  readonly importMarkers: ImportMarkerRepository;
  withTransaction<T>(callback: (storage: StoragePort) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const assertConversationStateSize = (state: Record<string, unknown>): void => {
  let serialized: string;
  try { serialized = JSON.stringify(state); } catch { throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Состояние диалога имеет недопустимый формат.'); }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONVERSATION_STATE_BYTES) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Состояние диалога слишком большое.', { details: { maxBytes: MAX_CONVERSATION_STATE_BYTES } });
};

export const assertOwnedItemId = (itemId: string): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(itemId)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Идентификатор элемента имеет недопустимый формат.');
};
export const assertItemKind = (kind: string): void => {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(kind)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Тип элемента имеет недопустимый формат.');
};
export const assertItemBucket = (bucket: string): void => {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(bucket)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Группа элемента имеет недопустимый формат.');
};
