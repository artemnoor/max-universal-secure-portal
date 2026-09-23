import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AppConfig } from '../../core/config.js';
import { createPostgresClient, type SqlExecutor } from './client.js';

const MIGRATION_FILE_PATTERN = /^(\d+_.+)\.sql$/u;
const MIGRATION_LOCK_KEY = 28041988;

type MigrationFile = Readonly<{
  version: string;
  sql: string;
  checksum: string;
}>;

type MigrationRecord = Readonly<{
  version: string;
  checksum: string | null;
}>;

const readMigrationFiles = async (migrationDirectory: string, moduleMigrations: readonly Readonly<{ ownerId: string; version: string; sql: string }>[] = []): Promise<readonly MigrationFile[]> => {
  const fileNames = (await readdir(migrationDirectory))
    .filter((fileName) => MIGRATION_FILE_PATTERN.test(fileName))
    .sort((left, right) => {
      const leftVersion = BigInt(left.match(MIGRATION_FILE_PATTERN)?.[1].split('_', 1)[0] ?? '0');
      const rightVersion = BigInt(right.match(MIGRATION_FILE_PATTERN)?.[1].split('_', 1)[0] ?? '0');
      if (leftVersion < rightVersion) return -1;
      if (leftVersion > rightVersion) return 1;
      return left.localeCompare(right);
    });
  const coreMigrations = await Promise.all(fileNames.map(async (fileName) => {
    const sql = await readFile(join(migrationDirectory, fileName), 'utf8');
    return { version: fileName.replace(/\.sql$/u, ''), sql, checksum: createHash('sha256').update(sql, 'utf8').digest('hex') };
  }));
  const ownedMigrations = moduleMigrations.map((migration) => {
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(migration.ownerId) || !MIGRATION_FILE_PATTERN.test(`${migration.version}.sql`) || migration.sql.trim().length === 0) throw new Error('invalid explicit module migration');
    return { version: `${migration.ownerId}:${migration.version}`, sql: migration.sql, checksum: createHash('sha256').update(migration.sql, 'utf8').digest('hex') };
  });
  const versions = new Set<string>();
  for (const migration of [...coreMigrations, ...ownedMigrations]) {
    if (versions.has(migration.version)) throw new Error(`duplicate migration version ${migration.version}`);
    versions.add(migration.version);
  }
  return [...coreMigrations, ...ownedMigrations];
};

const readMigrationRecords = async (executor: SqlExecutor): Promise<readonly MigrationRecord[]> => {
  const result = await executor.query<MigrationRecord>(
    'SELECT version, checksum FROM schema_migrations',
  );
  return result.rows;
};

const assertMigrationVersionsKnown = (
  applied: readonly MigrationRecord[],
  migrationFiles: readonly MigrationFile[],
): ReadonlyMap<string, MigrationRecord> => {
  const knownVersions = new Set(migrationFiles.map((migration) => migration.version));
  for (const record of applied) {
    if (!knownVersions.has(record.version)) {
      throw new Error(`database contains an unknown migration ${record.version}`);
    }
  }
  return new Map(applied.map((record) => [record.version, record]));
};

const assertMigrationRecords = async (
  executor: SqlExecutor,
  migrationFiles: readonly MigrationFile[],
): Promise<void> => {
  const recordsByVersion = assertMigrationVersionsKnown(await readMigrationRecords(executor), migrationFiles);
  for (const migration of migrationFiles) {
    const record = recordsByVersion.get(migration.version);
    if (!record) throw new Error(`required database migration is missing: ${migration.version}`);
    if (record.checksum !== migration.checksum) {
      throw new Error(`migration checksum mismatch for ${migration.version}`);
    }
  }
};

const assertMigrationDriftFree = async (
  executor: SqlExecutor,
  migrationFiles: readonly MigrationFile[],
): Promise<void> => {
  const recordsByVersion = assertMigrationVersionsKnown(await readMigrationRecords(executor), migrationFiles);
  const checksumsByVersion = new Map(migrationFiles.map((migration) => [migration.version, migration.checksum]));
  for (const [version, record] of recordsByVersion) {
    const expectedChecksum = checksumsByVersion.get(version);
    if (record.checksum !== null && record.checksum !== expectedChecksum) {
      throw new Error(`migration checksum mismatch for ${version}`);
    }
  }
};

export const verifyMigrations = async (
  executor: SqlExecutor,
  migrationDirectory = join(process.cwd(), 'db', 'migrations'),
  moduleMigrations: readonly Readonly<{ ownerId: string; version: string; sql: string }>[] = [],
): Promise<void> => {
  await assertMigrationRecords(executor, await readMigrationFiles(migrationDirectory, moduleMigrations));
};

export const applyMigrations = async (
  config: Pick<AppConfig, 'databaseUrl' | 'isProduction' | 'logLevel'>,
  migrationDirectory = join(process.cwd(), 'db', 'migrations'),
  moduleMigrations: readonly Readonly<{ ownerId: string; version: string; sql: string }>[] = [],
): Promise<void> => {
  const client = createPostgresClient(config);
  try {
    await client.withConnection(async (session) => {
      let lockAcquired = false;
      try {
        await session.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
        lockAcquired = true;
        await session.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            checksum TEXT
          )
        `);
        await session.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');

        const migrationFiles = await readMigrationFiles(migrationDirectory, moduleMigrations);
        // Validate every existing record before any migration SQL can mutate the schema.
        await assertMigrationDriftFree(session, migrationFiles);

        for (const migrationFile of migrationFiles) {
          const { version, sql, checksum } = migrationFile;
          const applied = await session.query<{ version: string; checksum: string | null }>(
            'SELECT version, checksum FROM schema_migrations WHERE version = $1 LIMIT 1',
            [version],
          );
          if (applied.rowCount > 0) {
            const recordedChecksum = applied.rows[0]?.checksum;
            if (recordedChecksum && recordedChecksum !== checksum) {
              throw new Error(`migration checksum mismatch for ${version}`);
            }
            await session.query(
              'UPDATE schema_migrations SET checksum = $2 WHERE version = $1 AND checksum IS NULL',
              [version, checksum],
            );
            continue;
          }

          await session.query(sql);
          await session.query(
            `INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)
             ON CONFLICT (version) DO UPDATE SET checksum = COALESCE(schema_migrations.checksum, EXCLUDED.checksum)`,
            [version, checksum],
          );
        }
        await assertMigrationRecords(session, migrationFiles);
      } finally {
        if (lockAcquired) {
          try {
            await session.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]);
          } catch {
            // The migration error is more useful than a cleanup error; the pool still closes below.
          }
        }
      }
    });
  } finally {
    await client.close();
  }
};
