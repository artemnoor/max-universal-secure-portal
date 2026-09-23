import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const failures = [];
const read = async (path) => {
  try { return await readFile(join(root, path), 'utf8'); } catch { failures.push(`${path}: missing`); return ''; }
};

const collect = async (directory) => {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (/\.(?:ts|mjs|js)$/u.test(entry.name)) files.push(path);
  }
  return files;
};

const moduleFiles = await collect('src/modules');
const forbiddenModuleImport = /(?:@maxhub\/max-bot-api|(?:\.\.\/)+(?:core|platform|http|infrastructure)|(?:src\/)?(?:core|platform|max|http|infrastructure)\/|\b(?:pg|ioredis|node:http|node:net)\b)/u;
for (const path of moduleFiles) {
  const source = await read(path);
  const imports = [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/gu)].map((match) => match[1]);
  const forbidden = imports.find((specifier) => forbiddenModuleImport.test(specifier));
  if (forbidden) failures.push(`${path}: ARCH-MODULE-IMPORT forbidden import ${forbidden}`);
  if (/\bprocess\.env\b/u.test(source)) failures.push(`${path}: ARCH-MODULE-CONFIG direct environment access`);
}

const composition = await read('src/entrypoints/composition.ts');
if (!composition.includes('modules?: readonly ModuleDefinition[]')) failures.push('src/entrypoints/composition.ts: ARCH-COMPOSITION module input missing');
if (!composition.includes('for (const module of options.modules ?? [])')) failures.push('src/entrypoints/composition.ts: ARCH-COMPOSITION registration loop missing');
if (/fixture|registerHttpRoute|registerCallbackAction|registerCommand/u.test(composition)) failures.push('src/entrypoints/composition.ts: ARCH-EMPTY default composition contains a fixture or product surface');

for (const path of ['deploy/nginx/nginx.conf', 'deploy/nginx/conf.d/portal.conf', 'docker-compose.edge.yml']) {
  const source = await read(path);
  if (/BOT_TOKEN|DATABASE_URL|REDIS_URL|POSTGRES_PASSWORD|REDIS_PASSWORD|PII_ENCRYPTION_KEY/u.test(source)) failures.push(`${path}: ARCH-EDGE-SECRET secret-shaped value in edge configuration`);
}

const unsafeFixture = await read('tests/fixtures/modules/unsafe-import.ts');
if (!/@maxhub\/max-bot-api/u.test(unsafeFixture)) failures.push('tests/fixtures/modules/unsafe-import.ts: ARCH-FORBIDDEN fixture no longer exercises the adapter boundary');

const trackedMetadata = await read('.gitignore');
if (!trackedMetadata.includes('.ai-factory/') || !trackedMetadata.includes('.agents/')) failures.push('.gitignore: ARCH-LOCAL-METADATA planning/agent artifacts are not ignored');

if (failures.length > 0) {
  console.error(`Architecture boundary check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Architecture boundary check passed (${moduleFiles.length} production module files scanned).`);
