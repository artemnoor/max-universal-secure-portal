import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const offline = process.argv.includes('--offline') || process.env.NPM_AUDIT_OFFLINE === 'true';
const auditArgs = ['audit', '--audit-level=high', ...(offline ? ['--offline'] : [])];
const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : npmCommand;
const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', [npmCommand, ...auditArgs].join(' ')] : auditArgs;

if (offline) {
  console.warn('[audit] offline mode uses the local npm advisory cache; repeat online before release.');
}

const child = spawn(command, commandArgs, { stdio: 'inherit', windowsHide: true });
child.once('error', (error) => {
  console.error(`[audit] failed to start npm audit: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (code !== 0) {
    console.error(`[audit] dependency audit failed with ${signal ?? `exit code ${code ?? 'unknown'}`}`);
    process.exitCode = 1;
  }
});
