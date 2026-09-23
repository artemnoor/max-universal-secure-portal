import test from 'node:test';
import assert from 'node:assert/strict';

import { callbackActionDefinitions, callbackTokenHash, parseCallbackAction } from '../../src/platform/max/callback-actions.js';

const principal = { userId: 42, role: 'user' as const };

test('callback parser accepts registered actions and rejects forged/oversized payloads', async () => {
  const action = await parseCallbackAction('module:run:resource-1', [
    { namespace: 'module', verb: 'run', requiresResource: true, authorize: ({ resource }, current) => resource === 'resource-1' && current.userId === 42 },
  ], principal);
  assert.deepEqual(action, { namespace: 'module', verb: 'run', resource: 'resource-1', raw: 'module:run:resource-1' });

  await assert.rejects(() => parseCallbackAction('module:delete:resource-1', [], principal), { code: 'FORBIDDEN' });
  await assert.rejects(() => parseCallbackAction('module:run:resource-1', [{ namespace: 'module', verb: 'run', requiresResource: true, authorize: () => false }], principal), { code: 'FORBIDDEN' });
  await assert.rejects(() => parseCallbackAction('module:run:' + 'x'.repeat(1024), [{ namespace: 'module', verb: 'run', requiresResource: true }], principal), { code: 'VALIDATION_FAILED' });
});

test('callback helpers are deterministic and have no built-in product actions', () => {
  assert.equal(callbackActionDefinitions().length, 0);
  assert.equal(callbackTokenHash('module:run:resource-1').length, 16);
});
