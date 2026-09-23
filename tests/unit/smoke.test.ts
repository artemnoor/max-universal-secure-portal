import assert from 'node:assert/strict';
import { test } from 'node:test';

test('core config facade and portal contracts import without a real BOT_TOKEN', async () => {
  const configModule = await import('../../src/config.js');
  const contractsModule = await import('../../src/portal/contracts.js');

  assert.equal(typeof configModule.getConfig, 'function');
  assert.equal(typeof contractsModule.portalResponseSchema.parse, 'function');
});
