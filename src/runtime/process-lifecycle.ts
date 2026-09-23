import type { Logger } from '../core/logger.js';
import type { PortalMetrics } from '../observability/metrics.js';

export type ProcessLifecycleOptions = Readonly<{
  logger: Logger;
  stop: () => Promise<void>;
  metrics?: PortalMetrics;
}>;

/** Installs one shutdown path for signals and fatal process-level failures. */
export const installProcessLifecycle = (options: ProcessLifecycleOptions): (() => void) => {
  let stopping = false;
  const shutdown = async (reason: string, fatal = false, error?: unknown): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (fatal) {
      options.metrics?.increment('uncaught_exception_total', { operation: reason });
      options.logger.fatal({ reason, ...(error ? { error } : {}) }, '[FIX] fatal process failure; shutting down');
    } else {
      options.metrics?.increment('graceful_shutdown_total', { operation: reason });
      options.logger.info({ reason }, '[FIX] graceful shutdown started');
    }
    try {
      await options.stop();
      options.logger.info({ reason }, '[FIX] graceful shutdown completed');
    } catch (error) {
      options.logger.error({ reason, error }, '[FIX] graceful shutdown failed');
      process.exitCode = 1;
    } finally {
      if (fatal) process.exitCode = 1;
    }
  };
  const onSignal = (signal: NodeJS.Signals): void => { void shutdown(signal); };
  const onUncaughtException = (error: Error): void => { void shutdown('uncaughtException', true, error); };
  const onUnhandledRejection = (reason: unknown): void => { void shutdown('unhandledRejection', true, reason); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('uncaughtException', onUncaughtException);
  process.once('unhandledRejection', onUnhandledRejection);
  return () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('uncaughtException', onUncaughtException);
    process.off('unhandledRejection', onUnhandledRejection);
  };
};
