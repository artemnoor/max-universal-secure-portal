import type { ConversationSessionState } from '../state.js';

export type UserProfileInput = Readonly<{
  userId: number;
  chatId?: number;
  firstName?: string;
  lastName?: string;
  username?: string | null;
}>;

export type UserRecord = Readonly<{
  userId: number;
  chatId?: number;
  firstName?: string;
  lastName?: string;
  username?: string | null;
  mode: 'default';
  conversationState: ConversationSessionState;
  createdAt: string;
  updatedAt: string;
}>;

export interface PortalUserStore {
  recordUser(profile: UserProfileInput): Promise<UserRecord>;
  getUser(userId: number): Promise<UserRecord | undefined>;
  saveConversationState(userId: number, state: ConversationSessionState): Promise<void>;
  getStats(): Promise<{ users: number }>;
  close?(): Promise<void>;
}
