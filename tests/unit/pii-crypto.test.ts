import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../../src/core/errors.js';
import {
  createPiiKeyRing,
  decryptPii,
  encryptPii,
} from '../../src/infrastructure/security/pii-crypto.js';

const keyRing = createPiiKeyRing({
  '1': '11'.repeat(32),
  '2': '22'.repeat(32),
});

test('PII crypto round-trips with authenticated principal/field context', () => {
  const encrypted = encryptPii('79990000000', 'user:42:phone', keyRing.get(2)!);
  const decrypted = decryptPii(encrypted, 'user:42:phone', keyRing);

  assert.equal(decrypted, '79990000000');
  assert.equal(encrypted.keyVersion, 2);
  assert.notEqual(encrypted.nonce, encryptPii('79990000000', 'user:42:phone', keyRing.get(2)!).nonce);
});

test('PII crypto rejects wrong context, tampering and unknown key version', () => {
  const encrypted = encryptPii('55.75,37.61', 'user:42:location', keyRing.get(1)!);
  const tamperedCiphertext = Buffer.from(encrypted.ciphertext, 'base64');
  tamperedCiphertext[0] ^= 1;

  assert.throws(() => decryptPii(encrypted, 'user:7:location', keyRing), AppError);
  assert.throws(() => decryptPii({ ...encrypted, ciphertext: tamperedCiphertext.toString('base64') }, 'user:42:location', keyRing), AppError);
  assert.throws(() => decryptPii({ ...encrypted, keyVersion: 99 }, 'user:42:location', keyRing), AppError);
});

test('PII key ring rejects invalid key material', () => {
  assert.throws(() => createPiiKeyRing({ '1': 'too-short' }), AppError);
});
