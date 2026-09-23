import { createHmac, timingSafeEqual } from 'node:crypto';

import { AppError, ERROR_CODES } from '../../core/errors.js';

export type MaxContactInput = Readonly<{
  vcfInfo: string;
  hash: string;
  maxInfoUserId?: number;
}>;

export type MaxContactValidationOptions = Readonly<{
  botToken: string;
  principalUserId: number;
}>;

const normalizeVcfInfo = (value: string): string => value.replaceAll('\\r\\n', '\r\n');

const safeEqualHex = (expected: string, actual: string): boolean => {
  if (!/^[a-f0-9]{64}$/iu.test(actual)) return false;
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(actual, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

export const validateMaxContact = (
  input: MaxContactInput,
  options: MaxContactValidationOptions,
): { phone: string } => {
  if (!options.botToken || !Number.isSafeInteger(options.principalUserId) || options.principalUserId <= 0) throw new AppError(ERROR_CODES.AUTH_INVALID, 401, 'Не удалось подтвердить контакт.');
  if (typeof input.vcfInfo !== 'string' || input.vcfInfo.length === 0 || input.vcfInfo.length > 16 * 1024) throw new AppError(ERROR_CODES.AUTH_INVALID, 401, 'Не удалось подтвердить контакт.');
  if (input.maxInfoUserId !== undefined && input.maxInfoUserId !== options.principalUserId) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Контакт принадлежит другому пользователю.');
  const normalizedVcfInfo = normalizeVcfInfo(input.vcfInfo);
  const expectedHash = createHmac('sha256', options.botToken).update(normalizedVcfInfo).digest('hex');
  if (!safeEqualHex(expectedHash, input.hash)) throw new AppError(ERROR_CODES.AUTH_INVALID, 401, 'Не удалось подтвердить контакт.');
  const phoneMatch = normalizedVcfInfo.match(/(?:^|\r\n)TEL[^:]*:([^\r\n]+)/iu);
  const phone = phoneMatch?.[1]?.trim() ?? '';
  if (!phone || !/^[+()\d\s-]{5,32}$/u.test(phone)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Контакт не содержит корректный номер.');
  return { phone };
};

