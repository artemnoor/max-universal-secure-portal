import { z } from 'zod';

import { AppError, ERROR_CODES } from '../core/errors.js';
import { MAX_CONVERSATION_STATE_BYTES } from './ports/storage.js';

const stateValue = z.unknown();
export const conversationStateSchema = z.object({
  stateVersion: z.literal(1),
  data: z.record(z.string(), stateValue).default({}),
}).strict();

export type ConversationSessionState = z.infer<typeof conversationStateSchema>;

const assertStateSize = (state: ConversationSessionState): void => {
  const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
  if (bytes > MAX_CONVERSATION_STATE_BYTES) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Состояние диалога слишком большое.');
};

export const parseConversationState = (raw: unknown): ConversationSessionState => {
  const candidate = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const parsed = conversationStateSchema.safeParse({ ...(candidate as Record<string, unknown>), stateVersion: 1 });
  if (!parsed.success) return { stateVersion: 1, data: {} };
  assertStateSize(parsed.data);
  return parsed.data;
};

export const transitionConversationState = (current: ConversationSessionState | undefined, patch: unknown): ConversationSessionState => {
  if (patch === undefined) return current ?? { stateVersion: 1, data: {} };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Изменение состояния имеет недопустимый формат.');
  const candidate = { ...(current ?? { stateVersion: 1, data: {} }), ...(patch as Record<string, unknown>), stateVersion: 1 };
  const parsed = conversationStateSchema.safeParse(candidate);
  if (!parsed.success) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Изменение состояния не прошло проверку.');
  assertStateSize(parsed.data);
  return parsed.data;
};
