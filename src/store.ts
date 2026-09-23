import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AppError, ERROR_CODES } from './core/errors.js';
import { parseConversationState, transitionConversationState, type ConversationSessionState } from './portal/state.js';
import type { PortalUserStore, UserProfileInput, UserRecord } from './portal/ports/user-store.js';

type StoredUser = UserRecord;
type Database = { users: Record<string, StoredUser> };
const emptyDatabase = (): Database => ({ users: {} });
export const MAX_FILE_STORE_BYTES = 16 * 1024 * 1024;

const normalizeUser = (user: Partial<StoredUser> & Pick<StoredUser, 'userId'>): StoredUser => {
  const now = new Date().toISOString();
  return {
    userId: user.userId,
    ...(user.chatId === undefined ? {} : { chatId: user.chatId }),
    ...(user.firstName === undefined ? {} : { firstName: user.firstName }),
    ...(user.lastName === undefined ? {} : { lastName: user.lastName }),
    ...(user.username === undefined ? {} : { username: user.username }),
    mode: 'default',
    conversationState: parseConversationState(user.conversationState),
    createdAt: user.createdAt ?? now,
    updatedAt: user.updatedAt ?? now,
  };
};

export class Store implements PortalUserStore {
  private readonly filePath: string;
  private data: Database = emptyDatabase();
  private readonly readyPromise: Promise<void>;
  private writeQueue = Promise.resolve();

  constructor(dataDir: string, options: { allowFileStore?: boolean } = {}) {
    const environment = process.env.NODE_ENV?.trim().toLowerCase() || 'development';
    if (!(options.allowFileStore ?? (environment === 'development' || environment === 'test'))) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Локальное файловое хранилище отключено вне development/test.', { details: { environment, storage: 'file' } });
    this.filePath = join(dataDir, 'portal.json');
    this.readyPromise = this.load(dataDir);
  }
  private async load(dataDir: string): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    try {
      const info = await stat(this.filePath);
      if (info.size > MAX_FILE_STORE_BYTES) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Локальное хранилище слишком большое.');
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<Database>;
      this.data = { users: Object.fromEntries(Object.entries(parsed.users ?? {}).map(([id, user]) => [id, normalizeUser(user)])) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.persist();
    }
  }
  private async persist(): Promise<void> { await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8'); }
  private async mutate<T>(callback: (database: Database) => T | Promise<T>): Promise<T> {
    await this.readyPromise;
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.writeQueue; this.writeQueue = next; await previous;
    try { const result = await callback(this.data); await this.persist(); return result; } finally { release(); }
  }
  async recordUser(profile: UserProfileInput): Promise<UserRecord> {
    return this.mutate((database) => {
      const key = String(profile.userId);
      const current = database.users[key];
      const user = normalizeUser({ ...current, ...profile, userId: profile.userId, updatedAt: new Date().toISOString() });
      database.users[key] = user;
      return user;
    });
  }
  async getUser(userId: number): Promise<UserRecord | undefined> { await this.readyPromise; const user = this.data.users[String(userId)]; return user ? normalizeUser(user) : undefined; }
  async saveConversationState(userId: number, state: ConversationSessionState): Promise<void> {
    await this.mutate((database) => { const user = database.users[String(userId)]; if (user) database.users[String(userId)] = { ...user, conversationState: transitionConversationState(user.conversationState, state), updatedAt: new Date().toISOString() }; });
  }
  async getStats(): Promise<{ users: number }> { await this.readyPromise; return { users: Object.keys(this.data.users).length }; }
  async close(): Promise<void> { await this.readyPromise; }
}
