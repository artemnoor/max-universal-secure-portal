import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
if (!args.includes('--confirm')) throw new Error('Restore is destructive. Re-run with --confirm after checking the target database.');
const file = valueAfter('--file');
if (!file) throw new Error('Usage: npm run db:restore -- --file ./backups/portal.dump --confirm');
const backupFile = resolve(process.cwd(), file);
const fileInfo = await stat(backupFile).catch(() => undefined);
if (!fileInfo?.isFile()) throw new Error(`Backup file not found: ${backupFile}`);
const manifestFile = `${backupFile}.json`;
try {
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const checksum = createHash('sha256').update(await readFile(backupFile)).digest('hex');
  if (manifest.sha256 !== checksum) throw new Error('Backup checksum does not match its manifest.');
} catch (error) {
  if (error instanceof SyntaxError) throw new Error('Backup manifest is not valid JSON.');
  if (error instanceof Error && error.message.includes('ENOENT')) throw new Error('Backup manifest is missing; create a fresh backup before restoring.');
  throw error;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required for a restore.');
const connection = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !connection.hostname) throw new Error('DATABASE_URL must be a PostgreSQL URL.');
const pgEnv = { ...process.env };
if (connection.password) pgEnv.PGPASSWORD = decodeURIComponent(connection.password);
if (connection.searchParams.get('sslmode')) pgEnv.PGSSLMODE = connection.searchParams.get('sslmode');
const commandArgs = [
  '--exit-on-error',
  '--single-transaction',
  '--no-owner',
  '--host', connection.hostname,
  '--port', connection.port || '5432',
  '--username', decodeURIComponent(connection.username || 'postgres'),
  '--dbname', decodeURIComponent(connection.pathname.slice(1)),
  backupFile,
];

console.log(`[restore] restoring ${backupFile}; target is intentionally not printed`);
await new Promise((resolvePromise, reject) => {
  const child = spawn(process.env.PG_RESTORE_BIN || 'pg_restore', commandArgs, { env: pgEnv, stdio: 'inherit', windowsHide: true });
  child.once('error', (error) => reject(new Error(`pg_restore is unavailable: ${error.message}`)));
  child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`pg_restore failed with exit code ${code ?? 'unknown'}`)));
});
console.log('[restore] complete');
