import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryEphemeralStore } from '../../src/infrastructure/redis/ephemeral-store.js';
import { PortalApplication } from '../../src/portal/application.js';
import type { PortalModule } from '../../src/portal/contracts.js';
import type { StoragePort } from '../../src/portal/ports/storage.js';
import type { ModuleDefinition } from '../../src/portal/module-contracts.js';
import { PortalMetrics } from '../../src/observability/metrics.js';

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

test('catalog kernel dispatches module handlers, scopes state, and delivers bounded events', async () => {
  let observed = 0;
  const producer: ModuleDefinition = {
    manifest: { id: 'producer', version: 1, publicName: 'producer', dependsOn: [], consumes: [{ kind: 'message', mode: 'exclusive' }], requiresServices: [], providesServices: [], requiredCapabilities: ['events.publish'], publishesEvents: ['producer.done'] },
    setup(context) {
      context.onEvent('message', async (_event, moduleContext) => {
        await moduleContext.publish({ name: 'producer.done', version: 1, payload: { accepted: true } });
        return { response: { text: 'catalog response', actions: [] }, statePatch: { active: true } };
      });
    },
  };
  const observer: ModuleDefinition = {
    manifest: { id: 'observer', version: 1, publicName: 'observer', dependsOn: [{ id: 'producer', minVersion: 1 }], consumes: [], requiresServices: [], providesServices: [], requiredCapabilities: [], consumesEvents: ['producer.done'] },
    setup(context) {
      context.onModuleEvent('producer.done', async () => { observed += 1; });
    },
  };
  const store = storage();
  const app = new PortalApplication({ storage: store, ephemeral: new InMemoryEphemeralStore(), capabilities: new Set(['events.publish']) });
  app.registerModuleDefinition(observer);
  app.registerModuleDefinition(producer);
  app.finalizeModules();
  const response = await app.handle(event, { requestId: 'request-catalog', source: 'max', principal });
  assert.equal(response.text, 'catalog response');
  assert.equal(observed, 1);
  const persisted = await store.conversationStates.get(principal);
  assert.equal((persisted?.state.data as Record<string, Record<string, unknown>>).producer.active, true);
});

test('catalog kernel times out a slow module and records a bounded metric', async () => {
  const slow: ModuleDefinition = {
    manifest: { id: 'slow', version: 1, publicName: 'slow', dependsOn: [], consumes: [{ kind: 'message', mode: 'exclusive' }], requiresServices: [], providesServices: [], requiredCapabilities: [], timeoutMs: 5 },
    setup(context) {
      context.onEvent('message', async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        return { response: { text: 'late', actions: [] } };
      });
    },
  };
  const metrics = new PortalMetrics();
  const app = new PortalApplication({ storage: storage(), metrics });
  app.registerModuleDefinition(slow);
  app.finalizeModules();
  await assert.rejects(() => app.handle(event, { requestId: 'request-timeout', source: 'max', principal }), { code: 'DEPENDENCY_UNAVAILABLE' });
  assert.equal(metrics.snapshot()['module_timeout_total{module=slow}'], 1);
});
