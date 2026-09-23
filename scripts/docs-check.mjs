import { readFile } from 'node:fs/promises';

const required = [
  'docs/architecture.md',
  'docs/security/threat-model.md',
  'docs/security/ai-boundary.md',
  'docs/security/data-retention.md',
  'docs/operations/runbook.md',
  'docs/operations/rollout.md',
  'docs/max/webhook.md',
];
const requiredFragments = [
  ['docs/operations/runbook.md', 'health/ready'],
  ['docs/operations/rollout.md', 'verify:config'],
  ['docs/max/webhook.md', 'https://dev.max.ru/docs-api/methods/POST/subscriptions'],
  ['docs/security/threat-model.md', 'initData'],
  ['docker-compose.yml', 'dist/bot.js'],
  ['README.md', 'MAX bot и HTTP/Mini App runtime'],
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
