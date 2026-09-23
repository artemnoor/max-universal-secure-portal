import { readFile } from 'node:fs/promises';

const required = [
  'docs/architecture.md',
  'docs/architecture/modules.md',
  'src/modules/README.md',
  'docs/security/threat-model.md',
  'docs/security/ai-boundary.md',
  'docs/security/data-retention.md',
  'docs/operations/runbook.md',
  'docs/operations/observability.md',
  'docs/operations/backup-restore.md',
  'docs/operations/rollout.md',
  'docs/max/webhook.md',
];
const requiredFragments = [
  ['docs/operations/runbook.md', 'health/ready'],
  ['docs/operations/runbook.md', 'maxapp'],
  ['docs/operations/observability.md', '/internal/metrics'],
  ['docs/operations/backup-restore.md', 'pg_dump'],
  ['contracts/README.md', 'events.schema.json'],
  ['AGENTS.md', 'npm run check:full'],
  ['ARCHITECTURE.md', 'composition root'],
  ['DEPLOY.md', 'migrate'],
  ['LOGGING.md', '/internal/metrics'],
  ['MAX_PLATFORM.md', 'X-Max-Init-Data'],
  ['.githooks/pre-commit', 'npm run check'],
  ['docs/operations/rollout.md', 'verify:config'],
  ['docs/max/webhook.md', 'https://dev.max.ru/docs-api/methods/POST/subscriptions'],
  ['docs/security/threat-model.md', 'initData'],
  ['docker-compose.yml', 'command: ["bot"]'],
  ['README.md', 'MAX bot и HTTP/Mini App runtime'],
  ['docs/architecture/modules.md', 'ModuleContext'],
  ['src/modules/README.md', 'ModuleDefinition'],
];

const failures = [];
for (const file of required) {
  try { await readFile(file, 'utf8'); } catch { failures.push(`${file}: missing`); }
}
for (const [file, fragment] of requiredFragments) {
  try {
    const source = await readFile(file, 'utf8');
    if (!source.includes(fragment)) failures.push(`${file}: missing required fragment`);
  } catch {
    // The missing-file error is reported above.
  }
}
if (failures.length) {
  console.error(`Documentation check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Documentation check passed (${required.length} required files).`);
