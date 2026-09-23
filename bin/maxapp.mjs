#!/usr/bin/env node

import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = process.argv.slice(2);
const command = args.shift() ?? 'help';

const quoteWindowsArg = (value) => /[\s"&|<>^]/u.test(value)
  ? `"${value.replace(/["^]/gu, (character) => `^${character}`)}"`
  : value;

const usage = () => {
  console.log(`MAX Portal CLI

Usage:
  maxapp dev                         Start Mini App and MAX bot locally
  maxapp app                         Start only the HTTP/Mini App host
  maxapp bot                         Start only the MAX bot host
  maxapp migrate                     Apply PostgreSQL migrations
  maxapp doctor                      Validate local development configuration
  maxapp check [--full]              Run the fast or full quality gate
  maxapp compose up|down|logs        Manage the local PostgreSQL/Redis stack
  maxapp backup                     Create a PostgreSQL backup
  maxapp restore --file <path>       Restore a backup (requires --confirm)
`);
};

const run = (label, executable, executableArgs, options = {}) => new Promise((resolve, reject) => {
  console.log(`[maxapp] start ${label}`);
  const child = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [executable, ...executableArgs].map(quoteWindowsArg).join(' ')], { stdio: 'inherit', env: process.env, windowsHide: true, ...options })
    : spawn(executable, executableArgs, { stdio: 'inherit', env: process.env, ...options });
  const stop = () => { if (!child.killed) child.kill('SIGTERM'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.once('error', (error) => reject(error));
  child.once('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') resolve();
    else reject(new Error(`${label} failed with ${signal ?? `exit code ${code ?? 'unknown'}`}`));
  });
});

const npm = (...npmArgs) => run(npmArgs.join(' '), npmCommand, npmArgs);

try {
  if (command === 'help' || command === '--help' || command === '-h') usage();
  else if (command === 'dev') await npm('run', 'all');
  else if (command === 'app') await npm('run', 'app');
  else if (command === 'bot') await npm('run', 'dev');
  else if (command === 'migrate') await npm('run', 'db:migrate');
  else if (command === 'doctor') await npm('run', 'verify:config', '--', '--mode', process.env.NODE_ENV ?? 'development');
  else if (command === 'check') await npm('run', args.includes('--full') ? 'check:full' : 'check');
  else if (command === 'compose') {
    const composeCommand = args.shift() ?? 'up';
    if (!['up', 'down', 'logs'].includes(composeCommand)) throw new Error('compose accepts only up, down or logs');
    await npm('run', `compose:${composeCommand}`);
  } else if (command === 'backup') await npm('run', 'db:backup', '--', ...args);
  else if (command === 'restore') await npm('run', 'db:restore', '--', ...args);
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`[maxapp] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
