import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const source = await readFile('miniapp/app.js', 'utf8');
const index = await readFile('miniapp/index.html', 'utf8');
const failures = [];
if (!index.includes('type="module"')) failures.push('Mini App must load its module bootstrap');
if (/\binitData\b/u.test(source)) failures.push('Mini App bootstrap contains an auth value; keep auth in js/api.js');
if (/\?[^\n]*\b(userId|role|initData)=/u.test(source)) failures.push('Mini App source contains identity query parameters');
const auth = await readFile('miniapp/js/auth.js', 'utf8');
const api = await readFile('miniapp/js/api.js', 'utf8');
if (!auth.includes('window.MaxBridge') || !api.includes('window.MaxBridge')) failures.push('Mini App must support both MAX bridge global names');
if (failures.length) {
  console.error(`Mini App static security check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
const check = spawn(process.execPath, ['--check', 'miniapp/app.js'], { stdio: 'inherit' });
check.on('exit', (code) => process.exit(code ?? 1));
