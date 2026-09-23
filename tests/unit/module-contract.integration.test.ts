import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCallbackAction } from '../../src/platform/max/callback-actions.js';
import { DEFAULT_MODULE_CAPABILITIES } from '../../src/portal/module-policy.js';
import { PortalModuleRegistry } from '../../src/portal/module-registry.js';
import { PortalApplication } from '../../src/portal/application.js';
import { InMemoryEphemeralStore } from '../../src/infrastructure/redis/ephemeral-store.js';
import type { StoragePort } from '../../src/portal/ports/storage.js';
import { fixtureModule, fixtureProvider, fixtureServiceToken } from '../fixtures/modules/fixture-module.js';

const principal = { userId: 84, role: 'user' as const };

const storage = (): StoragePort => {
  let state: { version: number; data: Record<string, unknown> } | undefined;
  const audits: unknown[] = [];
  return {
    users: { async get() { return undefined; }, async upsert() { throw new Error('unused'); } },
    conversationStates: {
      async get() { return state ? { userId: principal.userId, version: state.version, state: { stateVersion: 1, data: state.data }, updatedAt: new Date() } : undefined; },
      async save(_principal, next, expectedVersion) { if (expectedVersion !== undefined && expectedVersion !== state?.version) throw new Error('state conflict'); state = { version: (state?.version ?? 0) + 1, data: (next.data ?? {}) as Record<string, unknown> }; return { userId: principal.userId, version: state.version, state: next, updatedAt: new Date() }; },
      async clear() { state = undefined; },
    },
    savedItems: { async list() { return []; }, async save() { throw new Error('unused'); }, async remove() {} },
    audit: { async append(event) { audits.push(event); } },
    updateInbox: { async reserve(eventKey) { return { eventKey, status: 'processed', duplicate: true }; }, async markProcessed() {}, async markFailed() {} },
    importMarkers: { async has() { return false; }, async mark(sourceChecksum, itemCount) { return { sourceChecksum, itemCount, importedAt: new Date() }; } },
    async withTransaction(callback) { return callback(this); }, async close() {},
    get audits() { return audits; },
  } as StoragePort & { audits: unknown[] };
};

test('neutral module uses only public contracts across every declared surface', async () => {
  const registry = new PortalModuleRegistry();
  registry.registerDefinition(fixtureModule);
  registry.registerDefinition(fixtureProvider);
  const catalog = registry.finalize();

  assert.deepEqual(catalog.modules.map((module) => module.manifest.id), ['fixture-provider', 'fixture']);
  assert.equal(catalog.services.get(fixtureServiceToken.id) && typeof (catalog.services.get(fixtureServiceToken.id) as { label(): string }).label, 'function');
  assert.equal(catalog.httpRoutes[0]?.moduleId, 'fixture');
  assert.equal(catalog.callbackDefinitions[0]?.moduleId, 'fixture');
  assert.equal(catalog.commands[0]?.name, 'fixture');

  const store = storage();
  const app = new PortalApplication({ storage: store, ephemeral: new InMemoryEphemeralStore(), moduleCatalog: catalog, capabilities: new Set(DEFAULT_MODULE_CAPABILITIES) });
  const response = await app.handle({ eventId: 'fixture-event', kind: 'message', principal, payload: { text: 'fixture' }, receivedAt: new Date() }, { requestId: 'fixture-request', source: 'max', principal });
  assert.equal(response.text, 'fixture');
  assert.equal((await store.conversationStates.get(principal))?.state.data && ((await store.conversationStates.get(principal))?.state.data as Record<string, Record<string, unknown>>).fixture.processed, true);
  assert.equal((store as StoragePort & { audits: unknown[] }).audits.length, 1);

  const routeBody = await catalog.httpRoutes[0]?.handle({ request: {} as never, url: new URL('https://portal.test/api/v1/fixture'), body: undefined, requestId: 'fixture-http', principal });
  assert.deepEqual(routeBody?.body, { authenticated: true });
  await assert.doesNotReject(() => parseCallbackAction('fixture:apply:record-1', catalog.callbackDefinitions, principal));
  assert.equal(catalog.readinessChecks.length, 0);
});
