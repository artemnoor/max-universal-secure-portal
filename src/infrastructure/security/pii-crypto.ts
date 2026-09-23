import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { EncryptedPii } from '../../portal/ports/storage.js';

const AES_ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export type PiiKey = Readonly<{
  version: number;
  material: Buffer;
}>;

export type PiiKeyRing = ReadonlyMap<number, PiiKey>;

const cryptoConfigError = (reason: string): AppError => new AppError(
  ERROR_CODES.CONFIG_INVALID,
  500,
  'Ключ шифрования PII настроен некорректно.',
  { details: { dependency: 'pii-crypto', reason } },
);

const cryptoValueError = (): AppError => new AppError(
  ERROR_CODES.AUTH_INVALID,
  400,
  'Защищённое значение недействительно.',
);

export const decodePiiKey = (encoded: string): Buffer => {
  if (/^[0-9a-fA-F]{64}$/u.test(encoded)) return Buffer.from(encoded, 'hex');
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw cryptoConfigError('key must be hex or base64');

  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length !== KEY_BYTES) throw cryptoConfigError('key must encode exactly 32 bytes');
  return decoded;
};

export const createPiiKeyRing = (keys: Readonly<Record<string, string>>): PiiKeyRing => {
  const ring = new Map<number, PiiKey>();
  for (const [versionText, encoded] of Object.entries(keys)) {
    const version = Number(versionText);
    if (!Number.isSafeInteger(version) || version <= 0) throw cryptoConfigError('key version must be a positive integer');
    ring.set(version, { version, material: decodePiiKey(encoded) });
  }
  if (ring.size === 0) throw cryptoConfigError('at least one key is required');
  return ring;
};

const assertContext = (context: string): void => {
  if (!context || context.length > 256 || /[\r\n]/u.test(context)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Контекст PII имеет недопустимый формат.');
  }
};

const keyFromRing = (ring: PiiKeyRing, version: number): PiiKey => {
  const key = ring.get(version);
  if (!key) throw cryptoValueError();
  return key;
};

export const encryptPii = (plaintext: string, context: string, key: PiiKey): EncryptedPii => {
  assertContext(context);
  if (typeof plaintext !== 'string' || plaintext.length > 4096) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Значение PII имеет недопустимый размер.');
  }
  if (key.material.length !== KEY_BYTES) throw cryptoConfigError('active key must encode exactly 32 bytes');

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key.material, nonce);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion: key.version,
  };
};

export const decryptPii = (value: EncryptedPii, context: string, ring: PiiKeyRing): string => {
  assertContext(context);
  const key = keyFromRing(ring, value.keyVersion);
  try {
    const decipher = createDecipheriv(AES_ALGORITHM, key.material, Buffer.from(value.nonce, 'base64'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw cryptoValueError();
  }
};
