import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const tsxCli = resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
const result = spawnSync(process.execPath, [tsxCli, '--test', '--experimental-test-coverage', 'tests/**/*.test.ts'], {
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
  windowsHide: true,
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(output);
if (result.error) {
  console.error(`Coverage runner failed: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const required = new Map([
  ['init-data-validator.ts', { lines: 90, branches: 65, functions: 95 }],
  ['contact-validator.ts', { lines: 90, branches: 60, functions: 90 }],
  ['callback-actions.ts', { lines: 85, branches: 60, functions: 75 }],
  ['deep-link-tokens.ts', { lines: 85, branches: 50, functions: 80 }],
  ['pii-crypto.ts', { lines: 85, branches: 65, functions: 95 }],
  ['route-policy.ts', { lines: 75, branches: 75, functions: 90 }],
]);

const rows = new Map();
for (const line of output.split(/\r?\n/u)) {
  const match = line.match(/^#\s+(.+?)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|/u);
  if (!match) continue;
  rows.set(match[1].trim(), {
    lines: Number(match[2]),
    branches: Number(match[3]),
    functions: Number(match[4]),
  });
}

const failures = [];
for (const [file, threshold] of required) {
  const actual = rows.get(file);
  if (!actual) {
    failures.push(`${file}: coverage row not found`);
    continue;
  }
  for (const [metric, minimum] of Object.entries(threshold)) {
    if (actual[metric] < minimum) failures.push(`${file} ${metric}=${actual[metric]} < ${minimum}`);
  }
  if (failures.length === 0 || !failures.some((failure) => failure.startsWith(`${file} `))) {
    console.log(`[PASS] coverage ${file}: lines ${actual.lines}%, branches ${actual.branches}%, functions ${actual.functions}%`);
  }
}

if (failures.length > 0) {
  console.error('Coverage thresholds failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Security coverage thresholds passed.');
