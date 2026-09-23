import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { verifyMigrations } from '../../src/infrastructure/postgres/migrate.js';
import type { SqlExecutor, SqlQueryResult } from '../../src/infrastructure/postgres/client.js';

const migrationPath = 'db/migrations/0001_initial.sql';

const migrationChecksum = async (): Promise<string> => createHash('sha256')
  .update(await readFile(migrationPath, 'utf8'), 'utf8')
  .digest('hex');

const executorFor = (rows: readonly Record<string, unknown>[]): SqlExecutor => ({
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<SqlQueryResult<Row>> {
    return { rows: rows as Row[], rowCount: rows.length };
  },
});

test('migration readiness accepts the complete current version set', async () => {
  await verifyMigrations(executorFor([{
    version: '0001_initial',
    checksum: await migrationChecksum(),
  }]));
});

test('migration readiness rejects missing or checksum-drifted versions', async () => {
  await assert.rejects(
    verifyMigrations(executorFor([])),
    /required database migration is missing/u,
  );
  await assert.rejects(
    verifyMigrations(executorFor([{ version: '0001_initial', checksum: 'bad' }])),
    /migration checksum mismatch/u,
  );
});

test('migration readiness rejects database versions absent from the image', async () => {
  await assert.rejects(
    verifyMigrations(executorFor([
      { version: '0001_initial', checksum: await migrationChecksum() },
      { version: '9999_removed', checksum: 'fixture' },
    ])),
    /unknown migration/u,
  );
});
