import assert from 'node:assert/strict';
import test from 'node:test';

import { createModuleHttpContent, moduleCallbackDefinitions, moduleCommands } from '../../src/portal/module-surfaces.js';
import { PortalModuleRegistry } from '../../src/portal/module-registry.js';

test('module surface adapters expose only finalized catalog entries', () => {
  const registry = new PortalModuleRegistry();
  registry.registerDefinition({
    manifest: { id: 'surface', version: 1, publicName: 'surface', dependsOn: [], consumes: [], requiresServices: [], providesServices: [], requiredCapabilities: ['http.route', 'callback.action', 'command.register'] },
    setup(context) {
      context.registerHttpRoute({ id: 'surface.health', method: 'GET', match: '/api/v1/surface', access: 'public', handle: () => ({ body: { ok: true } }) });
      context.registerCallbackAction({ namespace: 'surface', verb: 'run' });
      context.registerCommand({ name: 'surface', description: 'Surface command' });
    },
  });
  const catalog = registry.finalize();
  assert.equal(createModuleHttpContent(catalog).routes().length, 1);
  assert.equal(moduleCallbackDefinitions(catalog).length, 1);
  assert.equal(moduleCommands(catalog).length, 1);
});
