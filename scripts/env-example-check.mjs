import { readFile } from 'node:fs/promises';

const source = await readFile('.env.example', 'utf8');
const keys = new Set([...source.matchAll(/^([A-Z][A-Z0-9_]*)=/gmu)].map((match) => match[1]));
const required = [
  'BOT_TOKEN', 'NODE_ENV', 'MAX_API_BASE_URL', 'MAX_TRANSPORT', 'WEBHOOK_DOMAIN', 'WEBHOOK_PORT', 'WEBHOOK_PATH', 'WEBHOOK_SECRET',
  'APP_PORT', 'DATA_DIR', 'PUBLIC_APP_ORIGINS', 'DATABASE_URL', 'REDIS_URL', 'ALLOW_UNVERIFIED_MINIAPP', 'DEV_ALLOW_UNVERIFIED_MINIAPP',
  'INIT_DATA_TTL_SECONDS', 'PII_ENCRYPTION_KEY', 'ADMIN_USER_IDS', 'LOG_LEVEL', 'PORTAL_SECURITY_V2', 'PORTAL_STORAGE_V2', 'PORTAL_AI_ENABLED',
  'AI_API_URL', 'AI_API_KEY', 'AI_MODEL', 'METRICS_TOKEN',
];
const missing = required.filter((key) => !keys.has(key));
const secretKeys = ['BOT_TOKEN', 'WEBHOOK_SECRET', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'DATABASE_URL', 'REDIS_URL', 'PII_ENCRYPTION_KEY', 'AI_API_KEY', 'METRICS_TOKEN'];
const populatedSecrets = source.split(/\r?\n/u).filter((line) => secretKeys.some((key) => new RegExp(`^${key}=.+$`, 'u').test(line)));
if (missing.length > 0 || populatedSecrets.length > 0) {
  if (missing.length > 0) console.error(`Environment example check failed: missing ${missing.join(', ')}`);
  if (populatedSecrets.length > 0) console.error('Environment example check failed: secret-shaped values must remain empty.');
  process.exit(1);
}
console.log('Environment example check passed.');
