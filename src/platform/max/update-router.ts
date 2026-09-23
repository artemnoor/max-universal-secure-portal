import { createHash } from 'node:crypto';

import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { PortalPrincipal } from '../../core/principal.js';
import type { PortalEvent, PortalEventKind } from '../../portal/contracts.js';

type UnknownRecord = Record<string, unknown>;

export type MaxContextLike = Readonly<{
  updateType: string;
  update: unknown;
}>;

export type MaxUpdateRouterOptions = Readonly<{
  now?: () => Date;
  maxTextBytes?: number;
  maxCallbackBytes?: number;
  maxStartPayloadBytes?: number;
  isAdmin?: (userId: number) => boolean;
}>;

const SUPPORTED_UPDATE_TYPES = new Set([
  'bot_started',
  'message_created',
  'message_callback',
  'bot_added',
  'user_added',
  'bot_stopped',
  'bot_removed',
]);

const asRecord = (value: unknown): UnknownRecord | undefined => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined
);

const asPositiveInteger = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
);

const asBoundedString = (value: unknown, maxBytes: number, field: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'MAX update имеет недопустимый формат.', {
      details: { field },
    });
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'MAX update слишком большой.', {
      details: { field, maxBytes },
    });
  }
  return value;
};

const userFromUpdate = (update: UnknownRecord): UnknownRecord | undefined => {
  const callback = asRecord(update.callback);
  const message = asRecord(update.message);
  const messageSender = asRecord(message?.sender);
  return asRecord(callback?.user) ?? asRecord(update.user) ?? messageSender;
};

const principalFromUser = (user: UnknownRecord | undefined, isAdmin: (userId: number) => boolean): PortalPrincipal => {
  const userId = asPositiveInteger(user?.user_id) ?? asPositiveInteger(user?.id);
  if (!userId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'MAX update не содержит корректного пользователя.', {
      details: { field: 'user' },
    });
  }
  return {
    userId,
    role: isAdmin(userId) ? 'admin' : 'user',
  };
};

const eventKind = (updateType: string): PortalEventKind => {
  if (updateType === 'bot_started') return 'bot_started';
  if (updateType === 'message_created') return 'message';
  if (updateType === 'message_callback') return 'callback';
  return 'lifecycle';
};

const chatIdFromUpdate = (update: UnknownRecord): number | undefined => {
  const direct = asPositiveInteger(update.chat_id);
  if (direct) return direct;
  const message = asRecord(update.message);
  const recipient = asRecord(message?.recipient);
  return asPositiveInteger(recipient?.chat_id);
};

const boundedEventPart = (value: unknown): string => {
  if (typeof value === 'string') return value.slice(0, 256);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, 64);
  return String(value ?? '').slice(0, 64);
};

const eventIdFromUpdate = (update: UnknownRecord, principal: PortalPrincipal): string => {
  const callback = asRecord(update.callback);
  const message = asRecord(update.message);
  const body = asRecord(message?.body);
  const stableIdentifier = callback?.callback_id
    ?? body?.mid
    ?? update.message_id
    ?? `${update.update_type}:${update.timestamp ?? 'unknown'}:${principal.userId}`;
  const canonical = `${boundedEventPart(update.update_type)}:${boundedEventPart(update.timestamp)}:${boundedEventPart(stableIdentifier)}`;
  return `max_${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
};

const messagePayload = (update: UnknownRecord, maxTextBytes: number): UnknownRecord => {
  const message = asRecord(update.message);
  const body = asRecord(message?.body);
  if (!message || !body) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'MAX message_created имеет недопустимый формат.');
  }

  const text = asBoundedString(body.text, maxTextBytes, 'message.body.text');
  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
  const attachments = rawAttachments.slice(0, 16).map((attachment) => {
    const item = asRecord(attachment);
    const type = typeof item?.type === 'string' ? item.type.slice(0, 32) : 'unknown';
    const payload = asRecord(item?.payload);
    return {
      type,
      ...(type === 'audio' ? { hasAudioToken: typeof payload?.token === 'string' } : {}),
      ...(type === 'contact' ? { hasContactSignature: typeof payload?.hash === 'string' } : {}),
    };
  });

  return {
    type: 'message',
    ...(text !== undefined ? { text } : {}),
    attachments,
    messageId: typeof body.mid === 'string' ? body.mid.slice(0, 128) : undefined,
  };
};

export const normalizeMaxUpdate = (
  context: MaxContextLike,
  options: MaxUpdateRouterOptions = {},
): PortalEvent | undefined => {
  const update = asRecord(context.update);
  if (!update || typeof context.updateType !== 'string' || !SUPPORTED_UPDATE_TYPES.has(context.updateType)) return undefined;

  const maxTextBytes = options.maxTextBytes ?? 8 * 1024;
  const maxCallbackBytes = options.maxCallbackBytes ?? 1024;
  const maxStartPayloadBytes = options.maxStartPayloadBytes ?? 512;
  const principal = principalFromUser(userFromUpdate(update), options.isAdmin ?? (() => false));
  const kind = eventKind(context.updateType);
  const callback = asRecord(update.callback);
  const payload = context.updateType === 'message_created'
    ? messagePayload(update, maxTextBytes)
    : context.updateType === 'message_callback'
      ? {
          type: 'callback',
          callbackId: asBoundedString(callback?.callback_id, 256, 'callback.callback_id'),
          payload: asBoundedString(callback?.payload ?? '', maxCallbackBytes, 'callback.payload') ?? '',
          messageId: typeof asRecord(update.message)?.body === 'object'
            ? (asRecord(asRecord(update.message)?.body)?.mid as string | undefined)?.slice(0, 128)
            : undefined,
        }
      : context.updateType === 'bot_started'
        ? {
            type: 'bot_started',
            startPayload: asBoundedString(update.payload, maxStartPayloadBytes, 'payload'),
          }
        : { type: 'lifecycle', updateType: context.updateType };

  return {
    eventId: eventIdFromUpdate(update, principal),
    kind,
    principal: {
      ...principal,
      ...(chatIdFromUpdate(update) ? { chatId: chatIdFromUpdate(update) } : {}),
    },
    ...(chatIdFromUpdate(update) ? { chatId: chatIdFromUpdate(update) } : {}),
    payload,
    receivedAt: options.now?.() ?? new Date(),
  };
};

export const isSupportedMaxUpdateType = (value: string): boolean => SUPPORTED_UPDATE_TYPES.has(value);
