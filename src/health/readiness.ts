import { errorToLogFields } from '../core/errors.js';
import type { Logger } from '../core/logger.js';
import type { PortalMetrics } from '../observability/metrics.js';

export type ReadinessResult = Readonly<{ ok: boolean; checks: readonly string[] }>;
export type ReadinessCheck = Readonly<{ name: string; check: () => Promise<void> }>;

export const checkReadiness = async (
  checks: readonly ReadinessCheck[],
  logger?: Logger,
  metrics?: PortalMetrics,
): Promise<ReadinessResult> => {
  const failed: string[] = [];
  await Promise.all(checks.map(async ({ name, check }) => {
    try {
      await check();
    } catch (error) {
      failed.push(name);
      metrics?.increment('dependency_failures_total', { errorCode: 'READINESS_FAILED' });
      logger?.warn({ dependency: name, error: errorToLogFields(error) }, 'readiness dependency failed');
    }
  }));
  if (failed.length > 0) metrics?.increment('readiness_failures_total');
  return { ok: failed.length === 0, checks: failed };
};
