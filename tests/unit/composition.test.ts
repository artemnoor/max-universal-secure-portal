import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadConfig } from '../../src/core/config.js';
import { createLogger } from '../../src/core/logger.js';
import { createPortalComposition } from '../../src/entrypoints/composition.js';

test('composition root creates an empty universal catalog without product surfaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'max-portal-composition-'));
  const composition = createPortalComposition(loadConfig({ NODE_ENV: 'test', DATA_DIR: directory }), { logger: createLogger({ level: 'silent' }) });
  try {
    assert.equal(composition.catalog.modules.length, 0);
    assert.equal(composition.catalog.httpRoutes.length, 0);
    assert.equal(composition.catalog.callbackDefinitions.length, 0);
    assert.equal(composition.catalog.commands.length, 0);
    assert.equal(composition.application, undefined);
    assert.deepEqual(composition.portalInfo, { name: 'MAX Portal', contractVersion: 1, modules: [] });
  } finally {
    await composition.close();
    await rm(directory, { recursive: true, force: true });
  }
});
