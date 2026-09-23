import assert from 'node:assert/strict';
import test from 'node:test';

import { createModulePiiFactory } from '../../src/infrastructure/security/module-pii.js';
import { createDeniedModulePii } from '../../src/portal/ports/module-pii.js';

test('module PII port binds encryption context to the authenticated principal and module', () => {
  const factory = createModulePiiFactory('00'.repeat(32));
  const first = factory({ userId: 42, role: 'user' }, 'profile');
  const second = factory({ userId: 7, role: 'user' }, 'profile');
  const encrypted = first.encrypt('phone', '+70000000000');
  assert.equal(first.decrypt('phone', encrypted), '+70000000000');
  assert.throws(() => second.decrypt('phone', encrypted), /недействительно/u);
  assert.throws(() => first.decrypt('location', encrypted), /недействительно/u);
});

test('module PII is denied unless the composition explicitly grants the port', () => {
  const denied = createDeniedModulePii();
  assert.throws(() => denied.encrypt('phone', 'value'), /не разрешено/u);
  assert.throws(() => denied.decrypt('phone', { ciphertext: '', nonce: '', authTag: '', keyVersion: 1 }), /не разрешено/u);
});
