import assert from 'node:assert/strict';
import test from 'node:test';

import { createModuleStorage } from '../../src/portal/ports/module-storage.js';
import type { StoragePort } from '../../src/portal/ports/storage.js';

const principal = { userId: 7, role: 'user' as const };

const storageFixture = (): StoragePort => ({
  users: {
    async get(current) {
      assert.deepEqual(current, principal);
      return { userId: 7, role: 'user', phone: { ciphertext: 'secret', nonce: 'nonce', authTag: 'tag', keyVersion: 1 }, createdAt: new Date(), updatedAt: new Date() };
    },
    async upsert(current, profile) {
      assert.deepEqual(current, principal);
      assert.deepEqual(profile, { firstName: 'Artem' });
      return { userId: 7, role: 'user', firstName: 'Artem', phone: { ciphertext: 'secret', nonce: 'nonce', authTag: 'tag', keyVersion: 1 }, createdAt: new Date(), updatedAt: new Date() };
    },
  },
  conversationStates: {
    async get(current) { assert.deepEqual(current, principal); return undefined; },
    async save(current, state) { assert.deepEqual(current, principal); return { userId: 7, version: 1, state, updatedAt: new Date() }; },
    async clear(current) { assert.deepEqual(current, principal); },
  },
  savedItems: {
    async list(current) { assert.deepEqual(current, principal); return []; },
    async save(current, kind, itemId, bucket) { assert.deepEqual(current, principal); return { userId: 7, kind, itemId, bucket: bucket ?? 'default', createdAt: new Date() }; },
    async remove(current) { assert.deepEqual(current, principal); },
  },
  audit: { async append() {} },
  updateInbox: { async reserve(eventKey) { return { eventKey, status: 'received', duplicate: false }; }, async markProcessed() {}, async markFailed() {} },
  importMarkers: { async has() { return false; }, async mark(sourceChecksum, itemCount) { return { sourceChecksum, itemCount, importedAt: new Date() }; } },
  async withTransaction(callback) { return callback(this); },
  async close() {},
});

test('module storage scopes every operation and strips profile PII', async () => {
  const scoped = createModuleStorage(principal, storageFixture());
  const user = await scoped.getUser();
  assert.equal(user?.userId, 7);
  assert.equal('phone' in (user ?? {}), false);
  const saved = await scoped.upsertUser({ firstName: 'Artem' });
  assert.equal(saved.firstName, 'Artem');
  assert.equal('phone' in saved, false);
  await scoped.getState();
  await scoped.saveState({ active: true });
  await scoped.listSavedItems('notes');
  await scoped.saveItem('notes', 'item-1');
  await scoped.removeItem('notes', 'item-1');
  await scoped.appendAudit('item.saved', 'saved-item', 'item-1', { kind: 'notes' });
  await scoped.clearState();
});

test('module storage rejects unbounded or malformed module-owned data', async () => {
  const scoped = createModuleStorage(principal, storageFixture());
  await assert.rejects(() => scoped.saveState({ value: 'x'.repeat(33 * 1024) }), /слишком большое/u);
  await assert.rejects(() => scoped.saveItem('Bad Kind', 'item-1'), /недопустимый формат/u);
  await assert.rejects(() => scoped.saveItem('notes', '../item'), /недопустимый формат/u);
});
