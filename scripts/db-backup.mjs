import 'dotenv/config';

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required for a backup.');
const connection = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !connection.hostname) throw new Error('DATABASE_URL must be a PostgreSQL URL.');

const outputDir = resolve(process.cwd(), valueAfter('--output-dir') ?? process.env.BACKUP_DIR ?? './backups');
const label = (valueAfter('--label') ?? 'portal').replace(/[^A-Za-z0-9_-]/gu, '-').slice(0, 48) || 'portal';
const timestamp = new Date().toISOString().replace(/[.:]/gu, '-');
const outputFile = resolve(outputDir, `${label}-${timestamp}.dump`);
await mkdir(outputDir, { recursive: true });

const pgEnv = { ...process.env };
if (connection.password) pgEnv.PGPASSWORD = decodeURIComponent(connection.password);
if (connection.searchParams.get('sslmode')) pgEnv.PGSSLMODE = connection.searchParams.get('sslmode');
const commandArgs = [
  '--format=custom',
  '--no-owner',
  '--file', outputFile,
  '--host', connection.hostname,
  '--port', connection.port || '5432',
  '--username', decodeURIComponent(connection.username || 'postgres'),
  '--dbname', decodeURIComponent(connection.pathname.slice(1)),
];

console.log(`[backup] creating ${outputFile}`);
await new Promise((resolvePromise, reject) => {
  const child = spawn(process.env.PG_DUMP_BIN || 'pg_dump', commandArgs, { env: pgEnv, stdio: 'inherit', windowsHide: true });
  child.once('error', (error) => reject(new Error(`pg_dump is unavailable: ${error.message}`)));
  child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`pg_dump failed with exit code ${code ?? 'unknown'}`)));
});

const bytes = await import('node:fs/promises').then(({ readFile }) => readFile(outputFile));
const checksum = createHash('sha256').update(bytes).digest('hex');
await writeFile(`${outputFile}.json`, `${JSON.stringify({ createdAt: new Date().toISOString(), file: outputFile.split(/[\\/]/u).pop(), bytes: bytes.byteLength, sha256: checksum }, null, 2)}\n`, 'utf8');
console.log(`[backup] complete bytes=${bytes.byteLength} sha256=${checksum}`);
