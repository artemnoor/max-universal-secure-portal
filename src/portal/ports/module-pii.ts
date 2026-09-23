import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { PortalPrincipal } from '../../core/principal.js';
import type { EncryptedPii } from './storage.js';

export type ModulePii = Readonly<{
  encrypt(field: string, plaintext: string): EncryptedPii;
  decrypt(field: string, value: EncryptedPii): string;
}>;

export type ModulePiiFactory = (principal: PortalPrincipal, moduleId: string) => ModulePii;

export const createDeniedModulePii = (): ModulePii => Object.freeze({
  encrypt() { throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Модулю не разрешено работать с PII.'); },
  decrypt() { throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Модулю не разрешено работать с PII.'); },
});
