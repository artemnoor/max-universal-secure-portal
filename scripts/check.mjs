import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const profile = process.argv.includes('--full') ? 'full' : 'fast';

const fastChecks = [
  ['typecheck', 'npm run typecheck'],
  ['lint', 'npm run lint'],
  ['module boundaries', 'npm run check:module-boundaries'],
  ['architecture boundaries', 'npm run check:architecture'],
  ['shared contracts', 'npm run check:contracts'],
  ['environment example', 'npm run check:env'],
  ['unit and integration tests', 'npm test'],
];
const fullChecks = [
  ...fastChecks,
  ['build', 'npm run build'],
  ['Compose contract', 'npm run check:compose'],
  ['documentation', 'npm run docs:check'],
  ['browser smoke', 'npm run test:browser'],
  ['security coverage', 'npm run coverage:check'],
  ['dependency audit', 'npm run audit'],
];

const run = (label, command) => new Promise((resolve, reject) => {
  const child = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { stdio: 'inherit', windowsHide: true })
    : spawn(npmCommand, command.replace(/^npm\s+/u, '').split(/\s+/u), { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${label} failed with ${signal ?? `exit code ${code ?? 'unknown'}`}`));
  });
});

const checks = profile === 'full' ? fullChecks : fastChecks;
console.log(`[check] profile=${profile} checks=${checks.length}`);
try {
  for (const [label, command] of checks) {
    console.log(`[check] start ${label}`);
    await run(label, command);
    console.log(`[check] pass ${label}`);
  }
  console.log(`[check] ${profile} profile passed`);
} catch (error) {
  console.error(`[check] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
