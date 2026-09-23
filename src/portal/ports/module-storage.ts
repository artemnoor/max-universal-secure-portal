import type { PortalPrincipal } from '../../core/principal.js';
import { AppError, ERROR_CODES } from '../../core/errors.js';
import type {
  ConversationStateRecord,
  PortalUser,
  SavedItem,
  StoragePort,
  UserProfilePatch,
} from './storage.js';
import { assertItemBucket, assertItemKind, assertOwnedItemId, assertConversationStateSize } from './storage.js';

export type ModuleStorage = Readonly<{
  getUser(): Promise<ModuleUser | undefined>;
  upsertUser(profile: Omit<UserProfilePatch, 'phone' | 'location'>): Promise<ModuleUser>;
  getState(): Promise<ConversationStateRecord | undefined>;
  saveState(state: Record<string, unknown>, expectedVersion?: number, expiresAt?: Date): Promise<ConversationStateRecord>;
  clearState(): Promise<void>;
  listSavedItems(kind?: string): Promise<readonly SavedItem[]>;
  saveItem(kind: string, itemId: string, bucket?: string): Promise<SavedItem>;
  removeItem(kind: string, itemId: string): Promise<void>;
  appendAudit(action: string, resourceType: string, resourceId?: string, metadata?: Readonly<Record<string, boolean | number | string | null>>): Promise<void>;
}>;

export type ModuleUser = Omit<PortalUser, 'phone' | 'location'>;

const withoutPii = (user: PortalUser): ModuleUser => {
  const { phone: _phone, location: _location, ...safeUser } = user;
  return safeUser;
};

export const createModuleStorage = (
  principal: PortalPrincipal,
  storage: StoragePort,
  namespace?: string,
  maxStateBytes = 32 * 1024,
  requestId?: string,
): ModuleStorage => {
  if (namespace !== undefined && !/^[a-z][a-z0-9-]{0,31}$/u.test(namespace)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Идентификатор пространства модуля настроен некорректно.');
  if (!Number.isSafeInteger(maxStateBytes) || maxStateBytes < 1 || maxStateBytes > 32 * 1024) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Лимит состояния модуля настроен некорректно.');
  const profile = (input: Omit<UserProfilePatch, 'phone' | 'location'>): UserProfilePatch => ({ ...input });
  const conversationData = (record: ConversationStateRecord | undefined): Record<string, unknown> => {
    const candidate = record?.state.data;
    return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {};
  };
  const scopedState = (record: ConversationStateRecord | undefined): ConversationStateRecord | undefined => {
    if (!record || namespace === undefined) return record;
    const data = conversationData(record);
    const state = data && typeof data[namespace] === 'object' && data[namespace] !== null && !Array.isArray(data[namespace])
      ? data[namespace] as Record<string, unknown>
      : {};
    if (Buffer.byteLength(JSON.stringify(state), 'utf8') > maxStateBytes) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Состояние модуля слишком большое.');
    return { ...record, state };
  };
  const mergeState = async (state: Record<string, unknown>, expectedVersion?: number, expiresAt?: Date): Promise<ConversationStateRecord> => {
    if (namespace === undefined) return storage.conversationStates.save(principal, state, expectedVersion, expiresAt);
    const current = await storage.conversationStates.get(principal);
    const currentData = conversationData(current);
    const nextState = { ...(current ?? { stateVersion: 1, data: {} }).state, stateVersion: 1, data: { ...currentData, [namespace]: state } };
    const saved = await storage.conversationStates.save(principal, nextState, expectedVersion ?? current?.version, expiresAt);
    return { ...saved, state };
  };
  return Object.freeze({
    async getUser() {
      const user = await storage.users.get(principal);
      return user ? withoutPii(user) : undefined;
    },
    async upsertUser(input) {
      return withoutPii(await storage.users.upsert(principal, profile(input)));
    },
    async getState() {
      return scopedState(await storage.conversationStates.get(principal));
    },
    async saveState(state, expectedVersion, expiresAt) {
      assertConversationStateSize(state);
      if (Buffer.byteLength(JSON.stringify(state), 'utf8') > maxStateBytes) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Состояние модуля слишком большое.');
      return mergeState(state, expectedVersion, expiresAt);
    },
    async clearState() {
      if (namespace === undefined) {
        await storage.conversationStates.clear(principal);
        return;
      }
      const current = await storage.conversationStates.get(principal);
      if (!current) return;
      const currentData = conversationData(current);
      const { [namespace]: _removed, ...remainingData } = currentData;
      await storage.conversationStates.save(principal, { ...current.state, stateVersion: 1, data: remainingData }, current.version);
    },
    async listSavedItems(kind) {
      if (kind !== undefined) assertItemKind(kind);
      return storage.savedItems.list(principal, kind);
    },
    async saveItem(kind, itemId, bucket = 'default') {
      assertItemKind(kind);
      assertOwnedItemId(itemId);
      assertItemBucket(bucket);
      return storage.savedItems.save(principal, kind, itemId, bucket);
    },
    async removeItem(kind, itemId) {
      assertItemKind(kind);
      assertOwnedItemId(itemId);
      return storage.savedItems.remove(principal, kind, itemId);
    },
    async appendAudit(action, resourceType, resourceId, metadata) {
      if (!/^[a-z][a-z0-9._:-]{0,63}$/u.test(action) || !/^[a-z][a-z0-9._:-]{0,63}$/u.test(resourceType) || (resourceId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(resourceId))) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Аудит модуля имеет недопустимый формат.');
      }
      const safeMetadata = metadata ?? {};
      let serializedMetadata: string;
      try { serializedMetadata = JSON.stringify(safeMetadata); } catch { throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Метаданные аудита имеют недопустимый формат.'); }
      if (Object.keys(safeMetadata).some((key) => /phone|location|token|secret|password|auth/i.test(key)) || Buffer.byteLength(serializedMetadata, 'utf8') > 4096) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Метаданные аудита имеют недопустимый формат.');
      }
      await storage.audit.append({ principal, action, resourceType, ...(resourceId ? { resourceId } : {}), ...(namespace ? { moduleId: namespace } : {}), ...(requestId ? { requestId } : {}), occurredAt: new Date(), metadata: safeMetadata });
    },
  });
};
