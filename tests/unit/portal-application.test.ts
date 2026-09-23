import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryEphemeralStore } from '../../src/infrastructure/redis/ephemeral-store.js';
import { PortalApplication } from '../../src/portal/application.js';
import type { PortalModule } from '../../src/portal/contracts.js';
import type { StoragePort } from '../../src/portal/ports/storage.js';

const principal = { userId: 42, role: 'user' as const };
const storage = (): StoragePort => {
  let current: { version: number; state: Record<string, unknown> } | undefined;
  return {
    users: { async get() { return undefined; }, async upsert() { throw new Error('unused'); } },
    conversationStates: {
      async get() { return current ? { userId: 42, version: current.version, state: current.state, updatedAt: new Date() } : undefined; },
      async save(_principal, state, expectedVersion) { if (expectedVersion !== undefined && expectedVersion !== current?.version) throw new Error('conflict'); current = { version: (current?.version ?? 0) + 1, state }; return { userId: 42, version: current.version, state, updatedAt: new Date() }; },
      async clear() { current = undefined; },
    },
    savedItems: { async list() { return []; }, async save() { throw new Error('unused'); }, async remove() {} },
    audit: { async append() {} }, updateInbox: { async reserve(eventKey) { return { eventKey, status: 'processed', duplicate: true }; }, async markProcessed() {}, async markFailed() {} },
    importMarkers: { async has() { return false; }, async mark(sourceChecksum, itemCount) { return { sourceChecksum, itemCount, importedAt: new Date() }; } },
    async withTransaction(callback) { return callback(this); }, async close() {},
  };
};
const event = { eventId: 'fixture-event', kind: 'message' as const, principal, payload: { text: 'hello' }, receivedAt: new Date() };
const module: PortalModule = { id: 'fixture', version: 1, canHandle: (current) => current.kind === 'message', async handle() { return { text: 'module response', actions: [], statePatch: { data: { active: true } } }; } };
test('kernel dispatches only registered modules and persists bounded state', async () => { const store = storage(); const app = new PortalApplication({ storage: store, ephemeral: new InMemoryEphemeralStore() }); app.registerModule(module); const response = await app.handle(event, { requestId: 'request-1', source: 'max', principal }); assert.equal(response.text, 'module response'); assert.equal((await store.conversationStates.get(principal))?.state.data && ((await store.conversationStates.get(principal))?.state.data as Record<string, unknown>).active, true); });
test('kernel rejects events when no module claims them', async () => { const app = new PortalApplication({ storage: storage() }); await assert.rejects(() => app.handle({ ...event, kind: 'web_app' }, { requestId: 'request-2', source: 'miniapp', principal }), { code: 'FORBIDDEN' }); });

