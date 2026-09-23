import assert from 'node:assert/strict';
import test from 'node:test';

import { assertModuleEventEnvelope, createModuleServiceToken } from '../../src/portal/communication.js';

test('module communication validates typed service tokens and bounded events', () => {
  const token = createModuleServiceToken<{ run(): string }>('fixture.service', 2);
  assert.equal(token.id, 'fixture.service');
  assert.equal(token.version, 2);
  assert.doesNotThrow(() => assertModuleEventEnvelope({ name: 'fixture.ready', version: 1, moduleId: 'fixture', payload: { ok: true } }));
  assert.throws(() => createModuleServiceToken('Bad Service'), /Идентификатор сервиса/u);
  assert.throws(() => assertModuleEventEnvelope({ name: 'fixture.ready', version: 1, moduleId: 'fixture', payload: undefined }), /недопустимый формат/u);
  assert.throws(() => assertModuleEventEnvelope({ name: 'fixture.ready', version: 1, moduleId: 'fixture', payload: 'x'.repeat(9 * 1024) }), /слишком большие/u);
});

test('module communication rejects circular payloads without leaking implementation errors', () => {
  const payload: Record<string, unknown> = {};
  payload.self = payload;
  assert.throws(() => assertModuleEventEnvelope({ name: 'fixture.ready', version: 1, moduleId: 'fixture', payload }), /недопустимый формат/u);
});
