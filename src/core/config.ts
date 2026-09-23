import { z } from 'zod';

import { ConfigError } from './errors.js';
import { configuredOrigins, isSafeHostname } from './url-policy.js';

export type NodeEnvironment = 'development' | 'test' | 'staging' | 'production';
export type MaxTransport = 'polling' | 'webhook';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export type AppConfig = Readonly<{
  nodeEnv: NodeEnvironment;
  isProduction: boolean;
  botToken: string;
  miniAppBotUsername: string;
  maxApiBaseUrl: string;
  transport: MaxTransport;
  webhookDomain: string;
  webhookPort: number;
  webhookPath: string;
  webhookSecret: string;
  appPort: number;
  dataDir: string;
  publicAppOrigins: readonly string[];
  databaseUrl?: string;
  redisUrl?: string;
  allowUnverifiedMiniApp: boolean;
  devAllowUnverifiedMiniApp: boolean;
  initDataTtlSeconds: number;
  piiEncryptionKey: string;
  adminUserIds: readonly number[];
  aiApiUrl: string;
  aiApiKey: string;
  aiModel: string;
  metricsToken: string;
  portalSecurityV2: boolean;
  portalStorageV2: boolean;
  portalAiEnabled: boolean;
  logLevel: LogLevel;
}>;

const NODE_ENV_VALUES = ['development', 'test', 'staging', 'production'] as const;
const LOG_LEVEL_VALUES = ['debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
const parseBoolean = (value: unknown): unknown => {
  if (value === undefined || value === '') return false;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' ? true : normalized === 'false' ? false : value;
};
const parseNumber = (fallback: number) => (value: unknown): unknown => {
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : value;
};
const parseOrigins = (value: unknown): unknown => {
  if (value === undefined || value === '') return ['http://localhost:8787'];
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : value;
};
const isHttpOrigin = (value: string): boolean => {
  try {
    const origin = new URL(value);
    return ['http:', 'https:'].includes(origin.protocol)
      && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash;
  } catch { return false; }
};
const optionalTrimmedString = z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, z.string().trim().min(1).optional());

const rawEnvironmentSchema = z.object({
  NODE_ENV: z.preprocess((value) => typeof value === 'string' ? value.trim().toLowerCase() : value, z.enum(NODE_ENV_VALUES).default('development')),
  BOT_TOKEN: z.string().trim().default(''),
  MINI_APP_BOT_USERNAME: z.string().trim().default(''),
  MAX_API_BASE_URL: z.string().trim().url().default('https://platform-api2.max.ru'),
  MAX_TRANSPORT: z.preprocess((value) => typeof value === 'string' ? value.trim().toLowerCase() : value, z.enum(['polling', 'webhook']).default('polling')),
  WEBHOOK_DOMAIN: z.string().trim().default(''),
  WEBHOOK_PORT: z.preprocess(parseNumber(3000), z.number().int().min(1).max(65535)),
  WEBHOOK_PATH: z.string().trim().default('/max/webhook'),
  WEBHOOK_SECRET: z.string().trim().default(''),
  APP_PORT: z.preprocess(parseNumber(8787), z.number().int().min(1).max(65535)),
  DATA_DIR: z.string().trim().min(1).default('./data'),
  PUBLIC_APP_ORIGINS: z.preprocess(parseOrigins, z.array(z.string().trim().url()).min(1)),
  DATABASE_URL: optionalTrimmedString,
  REDIS_URL: optionalTrimmedString,
  ALLOW_UNVERIFIED_MINIAPP: z.preprocess(parseBoolean, z.boolean()),
  DEV_ALLOW_UNVERIFIED_MINIAPP: z.preprocess(parseBoolean, z.boolean()),
  INIT_DATA_TTL_SECONDS: z.preprocess(parseNumber(900), z.number().int().min(60).max(86400)),
  PII_ENCRYPTION_KEY: z.string().trim().default(''),
  ADMIN_USER_IDS: z.string().trim().default(''),
  AI_API_URL: z.string().trim().url().default('https://api.openai.com/v1'),
  AI_API_KEY: z.string().trim().default(''),
  AI_MODEL: z.string().trim().min(1).default('gpt-4o-mini'),
  METRICS_TOKEN: z.string().trim().default(''),
  PORTAL_SECURITY_V2: z.preprocess((value) => value === undefined || value === '' ? true : parseBoolean(value), z.boolean()),
  PORTAL_STORAGE_V2: z.preprocess((value) => value === undefined || value === '' ? true : parseBoolean(value), z.boolean()),
  PORTAL_AI_ENABLED: z.preprocess(parseBoolean, z.boolean()),
  LOG_LEVEL: z.preprocess((value) => typeof value === 'string' ? value.trim().toLowerCase() : value, z.enum(LOG_LEVEL_VALUES).default('info')),
});
type RawEnvironment = z.infer<typeof rawEnvironmentSchema>;

const throwSchemaError = (error: z.ZodError, environment: unknown): never => {
  const issue = error.issues[0];
  throw new ConfigError(String(issue?.path[0] ?? 'environment'), typeof environment === 'string' && environment ? environment : 'unknown', issue?.message ?? 'invalid value');
};
const invariant = (key: string, environment: NodeEnvironment, reason: string): never => { throw new ConfigError(key, environment, reason); };
const hasValidKey = (value: string): boolean => {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try { return Buffer.from(value, 'base64').length === 32; } catch { return false; }
};
const parseAdminIds = (value: string, environment: NodeEnvironment): number[] => {
  if (!value) return [];
  const items = value.split(',').map((item) => item.trim());
  if (items.some((item) => !/^\d+$/.test(item))) invariant('ADMIN_USER_IDS', environment, 'must be a comma-separated list of positive integers');
  const ids = items.map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) invariant('ADMIN_USER_IDS', environment, 'must contain only positive safe integers');
  return ids;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = rawEnvironmentSchema.safeParse(env);
  if (!parsed.success) return throwSchemaError(parsed.error, env.NODE_ENV);
  const raw: RawEnvironment = parsed.data;
  const environment = raw.NODE_ENV;
  const runtime = environment !== 'test';
  if (runtime && !raw.BOT_TOKEN) invariant('BOT_TOKEN', environment, 'is required outside test configuration');
  if (environment === 'staging' || environment === 'production') {
    if (raw.MAX_TRANSPORT !== 'webhook') invariant('MAX_TRANSPORT', environment, 'must be webhook in staging/production');
    if (!raw.DATABASE_URL) invariant('DATABASE_URL', environment, 'is required in staging/production');
    if (!raw.REDIS_URL) invariant('REDIS_URL', environment, 'is required in staging/production');
    if (!raw.PII_ENCRYPTION_KEY || !hasValidKey(raw.PII_ENCRYPTION_KEY)) invariant('PII_ENCRYPTION_KEY', environment, 'must encode exactly 32 bytes in hex or base64');
    const databaseUrl = new URL(raw.DATABASE_URL ?? '');
    const redisUrl = new URL(raw.REDIS_URL ?? '');
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) invariant('DATABASE_URL', environment, 'must use the postgres or postgresql scheme');
    if (!['redis:', 'rediss:'].includes(redisUrl.protocol)) invariant('REDIS_URL', environment, 'must use the redis or rediss scheme');
    if (environment === 'production') {
      if (databaseUrl.searchParams.has('sslmode') && databaseUrl.searchParams.get('sslmode') !== 'verify-full') invariant('DATABASE_URL', environment, 'sslmode must be verify-full when specified');
      if (redisUrl.protocol !== 'rediss:') invariant('REDIS_URL', environment, 'must use rediss:// for production TLS');
      if (raw.PUBLIC_APP_ORIGINS.some((origin) => !isHttpOrigin(origin) || !origin.startsWith('https://'))) invariant('PUBLIC_APP_ORIGINS', environment, 'must contain only https origins without paths in production');
      if (!raw.WEBHOOK_DOMAIN) invariant('WEBHOOK_DOMAIN', environment, 'is required for the production Webhook');
      if (raw.ALLOW_UNVERIFIED_MINIAPP || raw.DEV_ALLOW_UNVERIFIED_MINIAPP) invariant('ALLOW_UNVERIFIED_MINIAPP', environment, 'unverified Mini App auth is disabled in production');
    }
    if (!raw.PORTAL_SECURITY_V2) invariant('PORTAL_SECURITY_V2', environment, 'must be explicitly enabled after the security gate');
    if (!raw.PORTAL_STORAGE_V2) invariant('PORTAL_STORAGE_V2', environment, 'must be explicitly enabled after the storage gate');
    if (!/^[A-Za-z0-9_-]{5,256}$/.test(raw.WEBHOOK_SECRET)) invariant('WEBHOOK_SECRET', environment, 'must contain 5-256 URL-safe characters');
  }
  if (raw.PORTAL_AI_ENABLED) {
    if (!raw.AI_API_KEY) invariant('AI_API_KEY', environment, 'is required when PORTAL_AI_ENABLED=true');
    const aiUrl = new URL(raw.AI_API_URL);
    if (aiUrl.protocol !== 'https:' || aiUrl.username || aiUrl.password || aiUrl.search || aiUrl.hash) invariant('AI_API_URL', environment, 'must use HTTPS without credentials, query or fragment');
  }
  if (raw.METRICS_TOKEN && !/^[A-Za-z0-9._-]{16,256}$/u.test(raw.METRICS_TOKEN)) invariant('METRICS_TOKEN', environment, 'must contain 16-256 URL-safe characters');
  const maxUrl = new URL(raw.MAX_API_BASE_URL);
  if (runtime && (maxUrl.protocol !== 'https:' || maxUrl.username || maxUrl.password || maxUrl.search || maxUrl.hash || !isSafeHostname(maxUrl.hostname))) invariant('MAX_API_BASE_URL', environment, 'must use HTTPS without credentials, query or fragment');
  if (raw.PUBLIC_APP_ORIGINS.some((origin) => !isHttpOrigin(origin))) invariant('PUBLIC_APP_ORIGINS', environment, 'must contain only http/https origins without paths');
  if (raw.MAX_TRANSPORT === 'webhook' && !raw.WEBHOOK_DOMAIN) invariant('WEBHOOK_DOMAIN', environment, 'is required when MAX_TRANSPORT=webhook');
  if (raw.WEBHOOK_DOMAIN && !isSafeHostname(raw.WEBHOOK_DOMAIN)) invariant('WEBHOOK_DOMAIN', environment, 'must be an ASCII host name without scheme, path, port or credentials');
  if (!/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,127}$/u.test(raw.WEBHOOK_PATH) || raw.WEBHOOK_PATH.includes('//') || raw.WEBHOOK_PATH.includes('..')) invariant('WEBHOOK_PATH', environment, 'must be a normalized absolute path');
  if (raw.WEBHOOK_SECRET && !/^[A-Za-z0-9_-]{5,256}$/.test(raw.WEBHOOK_SECRET)) invariant('WEBHOOK_SECRET', environment, 'must contain 5-256 URL-safe characters');
  if (raw.ALLOW_UNVERIFIED_MINIAPP && (environment !== 'development' || !raw.DEV_ALLOW_UNVERIFIED_MINIAPP)) invariant('ALLOW_UNVERIFIED_MINIAPP', environment, 'requires development and DEV_ALLOW_UNVERIFIED_MINIAPP=true');
  if (raw.DEV_ALLOW_UNVERIFIED_MINIAPP && environment !== 'development') invariant('DEV_ALLOW_UNVERIFIED_MINIAPP', environment, 'is allowed only in development');
  if (raw.PII_ENCRYPTION_KEY && !hasValidKey(raw.PII_ENCRYPTION_KEY)) invariant('PII_ENCRYPTION_KEY', environment, 'must encode exactly 32 bytes in hex or base64');

  return Object.freeze({
    nodeEnv: environment,
    isProduction: environment === 'production',
    botToken: raw.BOT_TOKEN,
    miniAppBotUsername: raw.MINI_APP_BOT_USERNAME,
    maxApiBaseUrl: raw.MAX_API_BASE_URL,
    transport: raw.MAX_TRANSPORT,
    webhookDomain: raw.WEBHOOK_DOMAIN,
    webhookPort: raw.WEBHOOK_PORT,
    webhookPath: raw.WEBHOOK_PATH,
    webhookSecret: raw.WEBHOOK_SECRET,
    appPort: raw.APP_PORT,
    dataDir: raw.DATA_DIR,
    publicAppOrigins: Object.freeze(configuredOrigins(raw.PUBLIC_APP_ORIGINS)),
    ...(raw.DATABASE_URL ? { databaseUrl: raw.DATABASE_URL } : {}),
    ...(raw.REDIS_URL ? { redisUrl: raw.REDIS_URL } : {}),
    allowUnverifiedMiniApp: raw.ALLOW_UNVERIFIED_MINIAPP,
    devAllowUnverifiedMiniApp: raw.DEV_ALLOW_UNVERIFIED_MINIAPP,
    initDataTtlSeconds: raw.INIT_DATA_TTL_SECONDS,
    piiEncryptionKey: raw.PII_ENCRYPTION_KEY,
    adminUserIds: Object.freeze(parseAdminIds(raw.ADMIN_USER_IDS, environment)),
    aiApiUrl: raw.AI_API_URL,
    aiApiKey: raw.AI_API_KEY,
    aiModel: raw.AI_MODEL,
    metricsToken: raw.METRICS_TOKEN,
    portalSecurityV2: raw.PORTAL_SECURITY_V2,
    portalStorageV2: raw.PORTAL_STORAGE_V2,
    portalAiEnabled: raw.PORTAL_AI_ENABLED,
    logLevel: raw.LOG_LEVEL,
  });
};
