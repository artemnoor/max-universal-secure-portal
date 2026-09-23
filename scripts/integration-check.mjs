import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const projectRoot = process.cwd();
const composeArgs = ['compose', '-p', `max-portal-integration-${process.pid}`, '-f', 'docker-compose.test.yml'];
const useExistingServices = process.env.INTEGRATION_USE_EXISTING_SERVICES === 'true';
const isolatedDatabaseUrl = `postgresql://${encodeURIComponent('portal_test')}:${encodeURIComponent(process.env.POSTGRES_PASSWORD || 'integration-test-password')}@127.0.0.1:15433/portal_test`;
const integrationDatabaseUrl = useExistingServices ? process.env.DATABASE_URL : isolatedDatabaseUrl;
const integrationRedisUrl = useExistingServices ? process.env.REDIS_URL : 'redis://127.0.0.1:16379';
const runDockerCompose = async (...args) => execFileAsync('docker', [...composeArgs, ...args], {
  cwd: projectRoot,
  env: process.env,
  maxBuffer: 4 * 1024 * 1024,
});

const ensureDockerRuntime = async () => {
  try {
    const { stdout } = await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      cwd: projectRoot,
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    if (!stdout.trim()) throw new Error('Docker server version was not returned');
  } catch {
    throw new Error('Docker Desktop Linux engine is unavailable. Start Docker Desktop and select the desktop-linux context before running the integration profile.');
  }
};

const runTests = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--test', 'tests/integration/postgres.test.ts'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BOT_TOKEN: 'integration-test-token',
      DATABASE_URL: integrationDatabaseUrl,
      REDIS_URL: integrationRedisUrl,
      PII_ENCRYPTION_KEY: process.env.PII_ENCRYPTION_KEY || '00'.repeat(32),
      RUN_POSTGRES_INTEGRATION: 'true',
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});

if (process.env.RUN_POSTGRES_INTEGRATION !== 'true') {
  console.log('Integration profile skipped: set RUN_POSTGRES_INTEGRATION=true to start the isolated PostgreSQL/Redis compose profile.');
  process.exit(0);
}

let composeStarted = false;
try {
  if (!useExistingServices) {
    await ensureDockerRuntime();
    console.log('Starting isolated PostgreSQL/Redis integration profile...');
    composeStarted = true;
    await runDockerCompose('up', '-d', '--wait');
  } else if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
    throw new Error('INTEGRATION_USE_EXISTING_SERVICES=true requires DATABASE_URL and REDIS_URL');
  }

  const code = await runTests();
  if (code !== 0) process.exitCode = code;
} catch (error) {
  console.error(`Integration profile failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (composeStarted) {
    try {
      await runDockerCompose('down', '--remove-orphans');
    } catch (error) {
      console.error(`Integration profile cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
