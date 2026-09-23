import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { AppError, ERROR_CODES } from '../../core/errors.js';

const maxUserSchema = z.object({
  id: z.number().int().positive().safe(),
  first_name: z.string().trim().min(1).max(128).optional(),
  last_name: z.string().trim().max(128).nullable().optional(),
  username: z.string().trim().max(128).nullable().optional(),
  language_code: z.string().trim().max(32).nullable().optional(),
  photo_url: z.string().trim().max(2048).nullable().optional(),
}).strict();

export type MaxSession = Readonly<{
  userId: number;
  user?: Readonly<{
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  }>;
  authDate: number;
  sessionFingerprint: string;
  rawHash: string;
}>;

export type InitDataValidatorOptions = Readonly<{
  botToken: string;
  ttlSeconds: number;
  now?: () => number;
  futureSkewSeconds?: number;
  maxBytes?: number;
}>;

type DecodedPair = Readonly<{ key: string; value: string }>;

const authError = (category: string, code: typeof ERROR_CODES.AUTH_REQUIRED | typeof ERROR_CODES.AUTH_INVALID | typeof ERROR_CODES.AUTH_EXPIRED): AppError => (
  new AppError(code, 401, code === ERROR_CODES.AUTH_EXPIRED ? 'Срок действия авторизации истёк.' : 'Не удалось подтвердить авторизацию.', {
    details: { category },
  })
);

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value.replaceAll('+', ' '));
  } catch {
    throw authError('malformed_encoding', ERROR_CODES.AUTH_INVALID);
  }
};

const parsePairs = (raw: string): DecodedPair[] => {
  if (!raw) throw authError('missing', ERROR_CODES.AUTH_REQUIRED);
  const pairs: DecodedPair[] = [];
  const seen = new Set<string>();
  for (const part of raw.split('&')) {
    const separator = part.indexOf('=');
    if (separator <= 0) throw authError('malformed_pair', ERROR_CODES.AUTH_INVALID);
    const key = decode(part.slice(0, separator));
    const value = decode(part.slice(separator + 1));
    if (!key || seen.has(key)) throw authError('duplicate_key', ERROR_CODES.AUTH_INVALID);
    seen.add(key);
    pairs.push({ key, value });
  }
  return pairs;
};

const constantTimeHexEqual = (expectedHex: string, actualHex: string): boolean => {
  if (!/^[a-f0-9]{64}$/iu.test(actualHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const validateMaxInitData = (raw: string, options: InitDataValidatorOptions): MaxSession => {
  const maxBytes = options.maxBytes ?? 16 * 1024;
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') === 0) throw authError('missing', ERROR_CODES.AUTH_REQUIRED);
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw authError('oversized', ERROR_CODES.AUTH_INVALID);
  if (!options.botToken) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'BOT_TOKEN не настроен.');

  const pairs = parsePairs(raw);
  const byKey = new Map(pairs.map((pair) => [pair.key, pair.value]));
  const hash = byKey.get('hash');
  const authDateRaw = byKey.get('auth_date');
  const userRaw = byKey.get('user');
  if (!hash || !authDateRaw || !userRaw) throw authError('missing_required', ERROR_CODES.AUTH_REQUIRED);
  if (!/^\d{1,12}$/u.test(authDateRaw)) throw authError('bad_auth_date', ERROR_CODES.AUTH_INVALID);
  const authDate = Number(authDateRaw);
  const now = options.now?.() ?? Math.floor(Date.now() / 1000);
  const futureSkewSeconds = options.futureSkewSeconds ?? 60;
  if (authDate > now + futureSkewSeconds) throw authError('future', ERROR_CODES.AUTH_INVALID);
  if (now - authDate > options.ttlSeconds) throw authError('expired', ERROR_CODES.AUTH_EXPIRED);

  const dataCheckString = pairs
    .filter((pair) => pair.key !== 'hash')
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    .map((pair) => `${pair.key}=${pair.value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(options.botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!constantTimeHexEqual(expectedHash, hash.toLowerCase())) throw authError('bad_signature', ERROR_CODES.AUTH_INVALID);

  let parsedUser: z.infer<typeof maxUserSchema>;
  try {
    parsedUser = maxUserSchema.parse(JSON.parse(userRaw));
  } catch {
    throw authError('bad_user', ERROR_CODES.AUTH_INVALID);
  }
  return {
    userId: parsedUser.id,
    user: {
      id: parsedUser.id,
      ...(parsedUser.first_name ? { first_name: parsedUser.first_name } : {}),
      ...(parsedUser.last_name ? { last_name: parsedUser.last_name } : {}),
      ...(parsedUser.username ? { username: parsedUser.username } : {}),
    },
    authDate,
    sessionFingerprint: createHash('sha256').update(hash.toLowerCase()).digest('hex').slice(0, 24),
    rawHash: hash.toLowerCase(),
  };
};
