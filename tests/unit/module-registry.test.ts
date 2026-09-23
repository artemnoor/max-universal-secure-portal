import assert from 'node:assert/strict';
import test from 'node:test';

import { PortalModuleRegistry } from '../../src/portal/module-registry.js';
import type { ModuleDefinition } from '../../src/portal/module-contracts.js';
import { createModuleServiceToken } from '../../src/portal/communication.js';

const moduleDefinition = (id: string, mode: 'exclusive' | 'broadcast' = 'exclusive'): ModuleDefinition => ({
  manifest: {
    id,
    version: 1,
    publicName: id,
    dependsOn: [],
    consumes: [{ kind: 'message', mode }],
    requiresServices: [],
    providesServices: [],
    requiredCapabilities: ['http.route', 'callback.action', 'command.register'],
  },
  setup(context) {
    context.onEvent('message', async () => ({ response: { text: id, actions: [] } }));
    context.registerHttpRoute({ id: `${id}.route`, method: 'GET', match: `/api/v1/${id}`, access: 'principal', handle: () => ({ body: { id } }) });
    context.registerCallbackAction({ namespace: id, verb: 'run' });
    context.registerCommand({ name: id, description: `${id} command` });
  },
});

test('module registry rejects missing dependencies and cycles before finalization', () => {
  const missing = new PortalModuleRegistry();
  missing.registerDefinition({
    ...moduleDefinition('consumer'),
    manifest: { ...moduleDefinition('consumer').manifest, dependsOn: [{ id: 'provider', minVersion: 1 }] },
  });
  assert.throws(() => missing.finalize(), /Зависимость модуля/u);

  const cycle = new PortalModuleRegistry();
  cycle.registerDefinition({ ...moduleDefinition('first'), manifest: { ...moduleDefinition('first').manifest, dependsOn: [{ id: 'second', minVersion: 1 }] } });
  cycle.registerDefinition({ ...moduleDefinition('second'), manifest: { ...moduleDefinition('second').manifest, dependsOn: [{ id: 'first', minVersion: 1 }] } });
  assert.throws(() => cycle.finalize(), /Циклическая зависимость/u);
});

test('module registry rejects duplicate routes, callbacks and exclusive event owners', () => {
  const registry = new PortalModuleRegistry();
  registry.registerDefinition(moduleDefinition('first'));
  registry.registerDefinition(moduleDefinition('second'));
  assert.throws(() => registry.finalize(), /Эксклюзивное событие/u);

  const duplicateRoute = new PortalModuleRegistry();
  duplicateRoute.registerDefinition(moduleDefinition('first'));
  duplicateRoute.registerDefinition({
    ...moduleDefinition('second', 'broadcast'),
    setup(context) {
      context.onEvent('message', async () => undefined);
      context.registerHttpRoute({ id: 'first.route', method: 'GET', match: '/api/v1/second', access: 'principal', handle: () => ({ body: {} }) });
    },
  });
  assert.throws(() => duplicateRoute.finalize(), /HTTP route/u);

  const duplicateCallback = new PortalModuleRegistry();
  duplicateCallback.registerDefinition(moduleDefinition('first', 'broadcast'));
  duplicateCallback.registerDefinition({
    ...moduleDefinition('second', 'broadcast'),
    setup(context) {
      context.onEvent('message', async () => undefined);
      context.registerCallbackAction({ namespace: 'first', verb: 'run' });
    },
  });
  assert.throws(() => duplicateCallback.finalize(), /Callback/u);
});

test('module registry finalizes dependencies in stable topological order and rejects duplicate services', () => {
  const order: string[] = [];
  const provider = createModuleServiceToken<{ value: string }>('fixture.service');
  const registry = new PortalModuleRegistry();
  registry.registerDefinition({
    manifest: { id: 'consumer', version: 1, publicName: 'consumer', dependsOn: [{ id: 'provider', minVersion: 1 }], consumes: [], requiresServices: [provider.id], providesServices: [], requiredCapabilities: ['service.require'] },
    setup(context) {
      order.push('consumer');
      assert.equal(context.requireService(provider).value, 'ok');
    },
  });
  registry.registerDefinition({
    manifest: { id: 'provider', version: 1, publicName: 'provider', dependsOn: [], consumes: [], requiresServices: [], providesServices: [provider.id], requiredCapabilities: ['service.provide'] },
    setup(context) {
      order.push('provider');
      context.provideService(provider, { value: 'ok' });
    },
  });
  registry.finalize();
  assert.deepEqual(order, ['provider', 'consumer']);

  const duplicate = new PortalModuleRegistry();
  duplicate.registerDefinition({ ...moduleDefinition('first', 'broadcast'), manifest: { ...moduleDefinition('first').manifest, providesServices: ['fixture.service'], requiredCapabilities: ['http.route', 'callback.action', 'command.register', 'service.provide'] }, setup(context) { context.provideService(provider, { value: 'a' }); } });
  duplicate.registerDefinition({ ...moduleDefinition('second', 'broadcast'), manifest: { ...moduleDefinition('second').manifest, providesServices: ['fixture.service'], requiredCapabilities: ['http.route', 'callback.action', 'command.register', 'service.provide'] }, setup(context) { context.provideService(provider, { value: 'b' }); } });
  assert.throws(() => duplicate.finalize(), /Сервис модуля/u);
});

test('module policy requires capabilities for transport surfaces and authorization for resource callbacks', () => {
  const route = new PortalModuleRegistry();
  route.registerDefinition({
    manifest: { ...moduleDefinition('route', 'broadcast').manifest, requiredCapabilities: [] },
    setup(context) { context.registerHttpRoute({ id: 'route.health', method: 'GET', match: '/api/v1/route', access: 'public', handle: () => ({ body: {} }) }); },
  });
  assert.throws(() => route.finalize(), /Интеграционная возможность/u);

  const callback = new PortalModuleRegistry();
  callback.registerDefinition({
    manifest: { ...moduleDefinition('callback', 'broadcast').manifest, requiredCapabilities: ['callback.action'] },
    setup(context) { context.registerCallbackAction({ namespace: 'callback', verb: 'resource', requiresResource: true }); },
  });
  assert.throws(() => callback.finalize(), /authorization policy/u);
});
