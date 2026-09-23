import { AppError, errorToLogFields, ERROR_CODES } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import type { PortalMetrics } from '../../observability/metrics.js';
import type { PortalEvent, PortalResponse } from '../../portal/contracts.js';
import type { StoragePort } from '../../portal/ports/storage.js';
import { createUpdateEventKey } from './update-id.js';

export type UpdateProcessingResult = 'processed' | 'duplicate' | 'locked' | 'failed';

export type UpdateProcessorOptions = Readonly<{
  storage: Pick<StoragePort, 'updateInbox'>;
  logger?: Logger;
  metrics?: PortalMetrics;
  retryFailedAfterSeconds?: number;
}>;

export const processMaxEvent = async (
  event: PortalEvent,
  handle: (event: PortalEvent) => Promise<PortalResponse | void>,
  options: UpdateProcessorOptions,
): Promise<UpdateProcessingResult> => {
  const eventKey = createUpdateEventKey(event);
  const reservation = await options.storage.updateInbox.reserve(eventKey, event.principal, {
    retryFailedAfterSeconds: options.retryFailedAfterSeconds,
  });
  if (reservation.duplicate && reservation.status === 'processed') {
    options.metrics?.increment('max_update_duplicate_total');
    options.metrics?.increment('webhook_duplicates_total');
    return 'duplicate';
  }
  if (reservation.duplicate && reservation.status === 'processing') {
    options.metrics?.increment('max_update_duplicate_total');
    options.metrics?.increment('webhook_duplicates_total');
    return 'locked';
  }

  try {
    await handle(event);
    await options.storage.updateInbox.markProcessed(eventKey);
    return 'processed';
  } catch (error) {
    const errorCode = error instanceof AppError ? error.code : ERROR_CODES.INTERNAL_ERROR;
    await options.storage.updateInbox.markFailed(eventKey, errorCode);
    options.metrics?.increment('max_update_failed_total');
    options.metrics?.increment('webhook_failures_total', { status: 'processing' });
    options.logger?.error({ eventKey, error: errorToLogFields(error) }, 'MAX update processing failed');
    return 'failed';
  }
};
