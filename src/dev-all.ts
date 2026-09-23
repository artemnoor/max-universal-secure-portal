import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { createLogger } from './core/logger.js';

const logger = createLogger({ bindings: { component: 'dev-all' } });
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children: ChildProcess[] = [];
let stopping = false;
const stopAll = (code = 0): void => { if (stopping) return; stopping = true; for (const child of children) child.kill(); setTimeout(() => process.exit(code), 300); };
const commands = [{ name: 'app', script: 'app' }, { name: 'bot', script: 'dev' }];
for (const task of commands) {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : npmCommand;
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', `${npmCommand} run ${task.script}`] : ['run', task.script];
  const child = spawn(command, args, { env: process.env, stdio: 'inherit', windowsHide: false });
  children.push(child);
  child.on('exit', (code) => { if (!stopping && code !== 0) { logger.error({ task: task.name, exitCode: code ?? 'unknown' }, 'development command exited'); stopAll(code ?? 1); } });
  child.on('error', () => { logger.error({ task: task.name }, 'development command failed to start'); stopAll(1); });
}
logger.info({ commands: commands.map((task) => task.name) }, 'development services started');
process.once('SIGINT', () => stopAll(0)); process.once('SIGTERM', () => stopAll(0));
