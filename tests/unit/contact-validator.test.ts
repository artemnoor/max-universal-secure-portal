import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { TEST_BOT_TOKEN } from '../fixtures/max-init-data.js';
import { validateMaxContact } from '../../src/platform/max/contact-validator.js';

const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nTEL;TYPE=CELL:+79990000000\r\nEND:VCARD\r\n';

test('MAX contact validates official vcf_info HMAC and binds the principal', () => {
  const hash = createHmac('sha256', TEST_BOT_TOKEN).update(vcf).digest('hex');
  assert.deepEqual(validateMaxContact({ vcfInfo: vcf, hash, maxInfoUserId: 42 }, { botToken: TEST_BOT_TOKEN, principalUserId: 42 }), { phone: '+79990000000' });
  const escaped = vcf.replaceAll('\r\n', '\\r\\n');
  assert.deepEqual(validateMaxContact({ vcfInfo: escaped, hash }, { botToken: TEST_BOT_TOKEN, principalUserId: 42 }), { phone: '+79990000000' });
});

test('MAX contact rejects tampering, wrong signature and foreign principal', () => {
  const hash = createHmac('sha256', TEST_BOT_TOKEN).update(vcf).digest('hex');
  assert.throws(() => validateMaxContact({ vcfInfo: vcf.replace('+7999', '+7000'), hash }, { botToken: TEST_BOT_TOKEN, principalUserId: 42 }), { code: 'AUTH_INVALID' });
  assert.throws(() => validateMaxContact({ vcfInfo: vcf, hash: '0'.repeat(64) }, { botToken: TEST_BOT_TOKEN, principalUserId: 42 }), { code: 'AUTH_INVALID' });
  assert.throws(() => validateMaxContact({ vcfInfo: vcf, hash, maxInfoUserId: 43 }, { botToken: TEST_BOT_TOKEN, principalUserId: 42 }), { code: 'FORBIDDEN' });
});

