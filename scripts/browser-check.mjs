import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = resolve(process.cwd());
const reservePort = async () => { const server = createServer(); await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise); }); const address = server.address(); await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())); if (!address || typeof address === 'string') throw new Error('Could not reserve a port'); return address.port; };
const waitForHttp = async (url) => { const deadline = Date.now() + 15_000; while (Date.now() < deadline) { try { const response = await fetch(url); if (response.ok) return; } catch {} await new Promise((resolvePromise) => setTimeout(resolvePromise, 100)); } throw new Error(`Timed out waiting for ${url}`); };
const stop = async (child) => { if (child.exitCode !== null) return; child.kill('SIGTERM'); await new Promise((resolvePromise) => { const timer = setTimeout(() => { if (child.exitCode === null) child.kill(); resolvePromise(); }, 2_000); child.once('exit', () => { clearTimeout(timer); resolvePromise(); }); }); };
const run = async () => {
  const port = await reservePort(); const base = `http://127.0.0.1:${port}`; const dataDir = await mkdtemp(join(tmpdir(), 'max-portal-browser-')); const output = [];
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/app-server.ts'], { cwd: root, env: { ...process.env, NODE_ENV: 'development', BOT_TOKEN: 'browser-check-token', MAX_TRANSPORT: 'polling', APP_PORT: String(port), PUBLIC_APP_ORIGINS: base, DATABASE_URL: '', REDIS_URL: '', ALLOW_UNVERIFIED_MINIAPP: 'false', DEV_ALLOW_UNVERIFIED_MINIAPP: 'false', DATA_DIR: dataDir, LOG_LEVEL: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', (chunk) => output.push(String(chunk))); child.stderr.on('data', (chunk) => output.push(String(chunk)));
  let browser;
  try {
    await waitForHttp(`${base}/health/live`); browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    if (await page.title() !== 'MAX Portal') throw new Error('Mini App title did not render');
    if (!(await page.locator('#status').textContent()).includes('готов')) throw new Error('Portal status did not render');
    if (await page.locator('#module-grid').count() !== 1) throw new Error('Portal module directory did not render');
    const portalInfo = await page.request.get(`${base}/api/v1/portal/info`);
    if (portalInfo.status() !== 200) throw new Error(`Portal info endpoint returned ${portalInfo.status()}`);
    const portalPayload = await portalInfo.json();
    if (!Array.isArray(portalPayload.modules)) throw new Error('Portal info did not return a module list');
    const queryAuth = await page.request.get(`${base}/api/v1/health?initData=browser-secret`); if (queryAuth.status() < 400) throw new Error('Query auth was accepted');
  } finally { await browser?.close(); await stop(child); await rm(dataDir, { recursive: true, force: true }); if (child.exitCode !== 0 && child.exitCode !== null) throw new Error(`Browser-check server exited: ${output.slice(-20).join('').slice(-4000)}`); }
};
try { await run(); console.log('Browser regression check passed (generic Mini App shell and auth boundary).'); } catch (error) { console.error(`Browser regression check failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
