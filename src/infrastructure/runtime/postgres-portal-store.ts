import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { PortalPrincipal } from '../../core/principal.js';
import type { ConversationStateRecord, StoragePort, UserProfilePatch } from '../../portal/ports/storage.js';
import type { PortalUserStore, UserProfileInput, UserRecord } from '../../portal/ports/user-store.js';
import { parseConversationState, transitionConversationState, type ConversationSessionState } from '../../portal/state.js';

const profilePatch = (profile: UserProfileInput): UserProfilePatch => ({
  ...(profile.chatId === undefined ? {} : { chatId: profile.chatId }),
  ...(profile.firstName === undefined ? {} : { firstName: profile.firstName }),
  ...(profile.lastName === undefined ? {} : { lastName: profile.lastName }),
  ...(profile.username === undefined || profile.username === null ? {} : { username: profile.username }),
});
const principal = (userId: number, admins: readonly number[]): PortalPrincipal => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Идентификатор пользователя недействителен.');
  return { userId, role: admins.includes(userId) ? 'admin' : 'user' };
};
const toRecord = (user: NonNullable<Awaited<ReturnType<StoragePort['users']['get']>>>, state: ConversationStateRecord | undefined): UserRecord => ({
  userId: user.userId,
  ...(user.chatId === undefined ? {} : { chatId: user.chatId }),
  ...(user.firstName === undefined ? {} : { firstName: user.firstName }),
  ...(user.lastName === undefined ? {} : { lastName: user.lastName }),
  ...(user.username === undefined ? {} : { username: user.username }),
  mode: 'default',
  conversationState: parseConversationState(state?.state),
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});

export type PostgresPortalStoreOptions = Readonly<{ storage: StoragePort; adminUserIds: readonly number[]; stats?: () => Promise<{ users: number }> }>;
export class PostgresPortalStore implements PortalUserStore {
  constructor(private readonly options: PostgresPortalStoreOptions) {}
  private principal(userId: number): PortalPrincipal { return principal(userId, this.options.adminUserIds); }
  private async ensure(userId: number): Promise<PortalPrincipal> { const current = this.principal(userId); await this.options.storage.users.upsert(current, {}); return current; }
  private async read(current: PortalPrincipal): Promise<{ record?: ConversationStateRecord; state: ConversationSessionState }> { const record = await this.options.storage.conversationStates.get(current); return { record, state: parseConversationState(record?.state) }; }
  private async mutate(userId: number, callback: (state: ConversationSessionState) => ConversationSessionState): Promise<void> {
    const currentPrincipal = await this.ensure(userId);
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.read(currentPrincipal);
      try { await this.options.storage.conversationStates.save(currentPrincipal, callback(current.state), current.record?.version); return; }
      catch (error) { if (!(error instanceof AppError) || error.status !== 409) throw error; last = error; }
    }
    throw last ?? new AppError(ERROR_CODES.DEPENDENCY_UNAVAILABLE, 503, 'Состояние пользователя занято.');
  }
  async recordUser(profile: UserProfileInput): Promise<UserRecord> { const p = this.principal(profile.userId); const user = await this.options.storage.users.upsert(p, profilePatch(profile)); return toRecord(user, await this.options.storage.conversationStates.get(p)); }
  async getUser(userId: number): Promise<UserRecord | undefined> { const p = this.principal(userId); const user = await this.options.storage.users.get(p); return user ? toRecord(user, await this.options.storage.conversationStates.get(p)) : undefined; }
  async saveConversationState(userId: number, state: ConversationSessionState): Promise<void> { await this.mutate(userId, (current) => transitionConversationState(current, state)); }
  async getStats(): Promise<{ users: number }> { return this.options.stats ? this.options.stats() : { users: 0 }; }
  async close(): Promise<void> { await this.options.storage.close(); }
}
