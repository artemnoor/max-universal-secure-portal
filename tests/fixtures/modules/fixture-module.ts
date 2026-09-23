import { createModuleServiceToken } from '../../../src/portal/communication.js';
import type { ModuleDefinition } from '../../../src/portal/module-contracts.js';

export const fixtureServiceToken = createModuleServiceToken<Readonly<{ label(): string }>>('fixture.service', 1);

export const fixtureProvider: ModuleDefinition = {
  manifest: {
    id: 'fixture-provider', version: 1, publicName: 'fixture-provider', dependsOn: [], consumes: [],
    requiresServices: [], providesServices: [fixtureServiceToken.id], requiredCapabilities: ['service.provide'],
  },
  setup(context) {
    context.provideService(fixtureServiceToken, { label: () => 'fixture' });
  },
};

export const fixtureModule: ModuleDefinition = {
  manifest: {
    id: 'fixture', version: 1, publicName: 'fixture', dependsOn: [{ id: 'fixture-provider', minVersion: 1 }],
    consumes: [{ kind: 'message', mode: 'exclusive' }], requiresServices: [fixtureServiceToken.id], providesServices: [],
    requiredCapabilities: ['service.require', 'http.route', 'callback.action', 'command.register', 'events.publish', 'state.write', 'audit.write'],
    consumesEvents: [], publishesEvents: ['fixture.changed'], maxStateBytes: 4 * 1024,
  },
  setup(context) {
    const service = context.requireService(fixtureServiceToken);
    context.onEvent('message', async (_event, moduleContext) => {
      await moduleContext.audit.append('fixture.processed', 'fixture-record', 'record-1', { source: 'fixture' });
      await moduleContext.publish({ name: 'fixture.changed', version: 1, payload: { label: service.label() } });
      return { response: { text: service.label(), actions: [] }, statePatch: { processed: true } };
    });
    context.registerHttpRoute({
      id: 'fixture.read', method: 'GET', match: '/api/v1/fixture', access: 'principal',
      handle: ({ principal }) => ({ body: { authenticated: principal !== undefined } }),
    });
    context.registerCallbackAction({
      namespace: 'fixture', verb: 'apply', requiresResource: true,
      authorize: (_action, principal) => principal.userId > 0,
    });
    context.registerCommand({ name: 'fixture', description: 'Neutral contract fixture' });
  },
};
