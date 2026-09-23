import { createRequire } from 'node:module';

import type { AppConfig } from '../../core/config.js';
import { AppError, ERROR_CODES, errorToLogFields } from '../../core/errors.js';
import { createLogger, type Logger } from '../../core/logger.js';

export type SqlQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = Readonly<{
  rows: Row[];
  rowCount: number;
}>;

export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

interface SqlConnection extends SqlExecutor {
  release(): void;
}

interface PoolLike extends SqlExecutor {
  connect(): Promise<SqlConnection>;
  end(): Promise<void>;
}

type PgModule = Readonly<{
  Pool: new (options: Record<string, unknown>) => PoolLike;
}>;

export type PostgresClient = SqlExecutor & Readonly<{
  withConnection<T>(callback: (executor: SqlExecutor) => Promise<T>): Promise<T>;
  withTransaction<T>(callback: (executor: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}>;

const require = createRequire(import.meta.url);

const sqlOperation = (sql: string): string => {
  const operation = sql.trim().match(/^[A-Za-z]+/)?.[0]?.toUpperCase();
  return operation ?? 'UNKNOWN';
};

const dependencyError = (reason: string, cause?: unknown): AppError => new AppError(
  ERROR_CODES.DEPENDENCY_UNAVAILABLE,
  503,
  'Хранилище временно недоступно.',
  { cause, details: { dependency: 'postgres', reason } },
);

const loadPgPool = (options: Record<string, unknown>): PoolLike => {
  let pg: PgModule;
  try {
    pg = require('pg') as PgModule;
  } catch (error) {
    throw dependencyError('pg package is not installed', error);
  }

  return new pg.Pool(options);
};

const createClientFromPool = (pool: PoolLike, logger: Logger): PostgresClient => {
  const client: PostgresClient = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<SqlQueryResult<Row>> {
      const operation = sqlOperation(text);
      const startedAt = Date.now();
      logger.debug({ operation, parameterCount: values.length }, 'postgres query start');
      try {
        const result = await pool.query(text, values) as SqlQueryResult<Row>;
        logger.debug({ operation, rowCount: result.rowCount, durationMs: Date.now() - startedAt }, 'postgres query complete');
        return result;
      } catch (error) {
        logger.error({ operation, durationMs: Date.now() - startedAt, error: errorToLogFields(error) }, 'postgres query failed');
        throw dependencyError(`query ${operation} failed`, error);
      }
    },
    async withConnection<T>(callback: (executor: SqlExecutor) => Promise<T>): Promise<T> {
      const connection = await pool.connect();
      try {
        return await callback(connection);
      } finally {
        connection.release();
      }
    },
    async withTransaction<T>(callback: (executor: SqlExecutor) => Promise<T>) {
      const connection = await pool.connect();
      const startedAt = Date.now();
      logger.debug({}, 'postgres transaction start');
      try {
        await connection.query('BEGIN');
        const result = await callback(connection);
        await connection.query('COMMIT');
        logger.debug({ durationMs: Date.now() - startedAt }, 'postgres transaction committed');
        return result;
      } catch (error) {
        try {
          await connection.query('ROLLBACK');
        } catch (rollbackError) {
          logger.error({ error: errorToLogFields(rollbackError) }, 'postgres transaction rollback failed');
        }
        logger.error({ durationMs: Date.now() - startedAt, error: errorToLogFields(error) }, 'postgres transaction rolled back');
        if (error instanceof AppError) throw error;
        throw dependencyError('transaction failed', error);
      } finally {
        connection.release();
      }
    },
    async close() {
      logger.info({}, 'postgres pool closing');
      await pool.end();
      logger.info({}, 'postgres pool closed');
    },
  };

  return client;
};

export const createPostgresClientFromPool = (
  pool: PoolLike,
  logLevel: AppConfig['logLevel'] = 'info',
): PostgresClient => createClientFromPool(
  pool,
  createLogger({ level: logLevel, bindings: { component: 'postgres' } }),
);

export const createPostgresClient = (
  config: Pick<AppConfig, 'databaseUrl' | 'isProduction' | 'logLevel'>,
): PostgresClient => {
  if (!config.databaseUrl) {
    throw dependencyError('DATABASE_URL is not configured');
  }

  const pool = loadPgPool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    ...(config.isProduction ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  return createPostgresClientFromPool(pool, config.logLevel);
};
