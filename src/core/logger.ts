import { createHmac } from 'node:crypto';

import type { LogLevel } from './config.js';
import { errorToLogFields } from './errors.js';

type LogFields = Record<string, unknown>;
type LogSink = (line: string, level: LogLevel) => void;

export type LoggerOptions = Readonly<{
  level?: LogLevel;
  bindings?: LogFields;
  sink?: LogSink;
}>;

export type Logger = Readonly<{
  level: LogLevel;
  child(bindings: LogFields): Logger;
  withContext(bindings: LogFields): Logger;
  debug(fields: unknown, message?: string): void;
  info(fields: unknown, message?: string): void;
  warn(fields: unknown, message?: string): void;
  error(fields: unknown, message?: string): void;
  fatal(fields: unknown, message?: string): void;
  audit(action: string, resourceType: string, resourceId: string, metadata?: LogFields): void;
}>;

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
  silent: Number.POSITIVE_INFINITY,
};

const REDACTED_KEYS = new Set([
  'authorization',
  'cookie',
  'xmaxinitdata',
  'initdata',
  'raw',
  'bottoken',
  'apikey',
  'phone',
  'vcfinfo',
  'latitude',
  'longitude',
  'databaseurl',
  'redisurl',
  'webhooksecret',
  'password',
  'secret',
]);

const normalizeKey = (key: string): string => key.replace(/[-_]/g, '').toLowerCase();

const isSensitiveKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return REDACTED_KEYS.has(normalized) || normalized.endsWith('token') || normalized.endsWith('secret');
};

const isSensitiveString = (value: string): boolean => {
  return /^Bearer\s/i.test(value)
    || /(?:^|[?&\s])(?:hash|auth_date|user)=/i.test(value)
    || /(?:BOT_TOKEN|WEBHOOK_SECRET|password|api[_-]?key)=/i.test(value);
};

export const redact = (value: unknown, key = ''): unknown => {
  if (key && isSensitiveKey(key)) return '[REDACTED]';
  if (value instanceof Error) return errorToLogFields(value);
  if (typeof value === 'string' && isSensitiveString(value)) return '[REDACTED]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item));

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redact(entryValue, entryKey),
    ]),
  );
};

const defaultSink: LogSink = (line, level) => {
  const output = level === 'warn' || level === 'error' || level === 'fatal'
    ? process.stderr
    : process.stdout;
  output.write(`${line}\n`);
};

const normalizeFields = (fields: unknown): LogFields => {
  if (fields instanceof Error) return errorToLogFields(fields);
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) return fields as LogFields;
  return fields === undefined ? {} : { value: fields };
};

const normalizeLevel = (value: string | undefined): LogLevel => {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error' || value === 'fatal' || value === 'silent') {
    return value;
  }
  return 'info';
};

export const principalHash = (userId: number, salt = process.env.LOG_PRINCIPAL_SALT ?? ''): string => {
  if (!salt) return 'unavailable';
  return createHmac('sha256', salt).update(String(userId)).digest('hex').slice(0, 16);
};

export const createLogger = (options: LoggerOptions = {}): Logger => {
  const level = options.level ?? normalizeLevel(process.env.LOG_LEVEL);
  const bindings = options.bindings ?? {};
  const sink = options.sink ?? defaultSink;

  const logger: Logger = {
    level,
    child(childBindings) {
      return createLogger({ level, bindings: { ...bindings, ...childBindings }, sink });
    },
    withContext(context) {
      return logger.child(context);
    },
    debug(fields, message) {
      write('debug', fields, message);
    },
    info(fields, message) {
      write('info', fields, message);
    },
    warn(fields, message) {
      write('warn', fields, message);
    },
    error(fields, message) {
      write('error', fields, message);
    },
    fatal(fields, message) {
      write('fatal', fields, message);
    },
    audit(action, resourceType, resourceId, metadata = {}) {
      write('info', {
        audit: {
          action,
          resourceType,
          resourceId,
          metadata: redact(metadata),
        },
      }, 'audit event');
    },
  };

  const write = (entryLevel: Exclude<LogLevel, 'silent'>, fields: unknown, message?: string): void => {
    if (LOG_LEVEL_WEIGHT[entryLevel] < LOG_LEVEL_WEIGHT[level]) return;

    const record = redact({
      time: new Date().toISOString(),
      level: entryLevel,
      ...bindings,
      ...normalizeFields(fields),
      ...(message ? { msg: message } : {}),
    }) as LogFields;
    sink(JSON.stringify(record), entryLevel);
  };

  return logger;
};
