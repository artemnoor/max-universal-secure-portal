import { decryptPii, decodePiiKey, encryptPii, type PiiKeyRing } from './pii-crypto.js';
import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { ModulePiiFactory } from '../../portal/ports/module-pii.js';

const FIELD = /^[a-z][a-z0-9_-]{0,31}$/u;
const MODULE = /^[a-z][a-z0-9-]{0,31}$/u;

export const createModulePiiFactory = (encodedKey: string): ModulePiiFactory => {
  const ring: PiiKeyRing = new Map([[1, { version: 1, material: decodePiiKey(encodedKey) }]]);
  const activeKey = ring.get(1);
  if (!activeKey) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Ключ PII модуля не настроен.');
  return (principal, moduleId) => {
    if (!MODULE.test(moduleId)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Контекст PII модуля настроен некорректно.');
    const context = (field: string): string => {
      if (!FIELD.test(field)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Поле PII модуля имеет недопустимый формат.');
      return `module:${moduleId}:user:${principal.userId}:${field}`;
    };
    return Object.freeze({
      encrypt: (field: string, plaintext: string) => encryptPii(plaintext, context(field), activeKey),
      decrypt: (field: string, value: Parameters<typeof decryptPii>[0]) => decryptPii(value, context(field), ring),
    });
  };
};
