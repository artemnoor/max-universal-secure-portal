import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const projectRoot = process.cwd();
const sourceRoot = join(projectRoot, 'src');
const modulesRoot = join(sourceRoot, 'modules');
const allowedConsoleFiles = new Set();

function collectTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function collectModuleFiles() {
  try {
    return collectTypeScriptFiles(modulesRoot);
  } catch {
    return [];
  }
}

const failures = [];
for (const filePath of collectTypeScriptFiles(sourceRoot)) {
  const relativePath = relative(projectRoot, filePath).replaceAll('\\', '/');
  const source = readFileSync(filePath, 'utf8');

  if (!allowedConsoleFiles.has(relativePath) && /\bconsole\.(log|warn|error|info|debug)\s*\(/u.test(source)) {
    failures.push(`${relativePath}: direct console usage is not allowed outside bootstrap adapters`);
  }

  if (/\bas\s+any\b|:\s*any\b|<any>/u.test(source)) {
    failures.push(`${relativePath}: explicit any is not allowed in the TypeScript source`);
  }

  if (source.includes('@maxhub/max-bot-api') && !relativePath.startsWith('src/platform/max/')) {
    failures.push(`${relativePath}: MAX SDK imports must stay inside src/platform/max`);
  }
}

for (const filePath of collectModuleFiles()) {
  const relativePath = relative(projectRoot, filePath).replaceAll('\\', '/');
  const source = readFileSync(filePath, 'utf8');
  const imports = [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/gu)].map((match) => match[1]);
  const forbiddenImport = imports.find((specifier) => specifier.includes('/src/core')
    || specifier.includes('../core')
    || specifier.includes('/core/')
    || specifier.includes('/src/platform')
    || specifier.includes('../platform')
    || specifier.includes('/platform/')
    || specifier.includes('/src/http')
    || specifier.includes('../http')
    || specifier.includes('/http/')
    || specifier.includes('/src/infrastructure')
    || specifier.includes('../infrastructure')
    || specifier.includes('/infrastructure/')
    || specifier.includes('@maxhub/max-bot-api')
    || specifier === 'pg'
    || specifier === 'ioredis'
    || specifier === 'node:http'
    || specifier === 'node:net');
  if (forbiddenImport) failures.push(`${relativePath}: feature modules cannot import ${forbiddenImport}`);
  if (/process\.env\b/u.test(source)) failures.push(`${relativePath}: feature modules cannot read process.env directly`);
}

if (failures.length > 0) {
  console.error('Lint failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Lint passed for ${collectTypeScriptFiles(sourceRoot).length} TypeScript files.`);
}
