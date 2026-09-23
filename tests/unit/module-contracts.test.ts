import assert from 'node:assert/strict';
import test from 'node:test';

import { createModuleServiceToken } from '../../src/portal/communication.js';
import type { ModuleDefinition } from '../../src/portal/module-contracts.js';
import { PortalModuleRegistry } from '../../src/portal/module-registry.js';

const definition = (id = 'fixture', setup: ModuleDefinition['setup'] = () => {}): ModuleDefinition => ({
  manifest: {
    id,
    version: 1,
    publicName: 'Fixture module',
    dependsOn: [],
    consumes: [],
    requiresServices: [],
    providesServices: [],
    requiredCapabilities: [],
  },
  setup,
});

test('module catalog accepts an empty module set and immutable valid definitions', () => {
  const registry = new PortalModuleRegistry();
  registry.registerDefinition(definition());
  const catalog = registry.finalize();

  assert.equal(catalog.modules.length, 1);
  assert.equal(catalog.httpRoutes.length, 0);
  assert.equal(registry.finalize(), catalog);
  assert.throws(() => registry.registerDefinition(definition('second')), /Каталог модулей уже закрыт/u);
});

test('module contract rejects invalid identity, dependency and capability declarations', () => {
  const invalid = definition('Bad_Module');
  assert.throws(() => new PortalModuleRegistry().registerDefinition(invalid), /недопустимый контракт/u);

  const duplicateDependency = definition('fixture', (context) => { context.addReadinessCheck({ name: 'ready', check: async () => {} }); });
  const withDependencies = { ...duplicateDependency, manifest: { ...duplicateDependency.manifest, dependsOn: [{ id: 'dependency', minVersion: 1 }, { id: 'dependency', minVersion: 1 }] } };
  assert.throws(() => new PortalModuleRegistry().registerDefinition(withDependencies), /Зависимости модуля/u);

  const withCapability = { ...definition(), manifest: { ...definition().manifest, requiredCapabilities: ['not a capability'] } };
  assert.throws(() => new PortalModuleRegistry().registerDefinition(withCapability), /Разрешения модуля/u);
});

test('module setup can declare a typed service only when the manifest allows it', () => {
  const token = createModuleServiceToken<{ ping(): string }>('fixture.service');
  const registry = new PortalModuleRegistry();
  registry.registerDefinition({
    ...definition('provider', (context) => context.provideService(token, { ping: () => 'pong' })),
    manifest: { ...definition().manifest, id: 'provider', providesServices: ['fixture.service'], requiredCapabilities: ['service.provide'] },
  });
  const catalog = registry.finalize();
  assert.equal((catalog.services.get('fixture.service') as { ping(): string }).ping(), 'pong');

  const denied = new PortalModuleRegistry();
  denied.registerDefinition({
    ...definition('denied', (context) => context.provideService(token, { ping: () => 'pong' })),
    manifest: { ...definition().manifest, id: 'denied', requiredCapabilities: ['service.provide'] },
  });
  assert.throws(() => denied.finalize(), /необъявленный сервис/u);
});
