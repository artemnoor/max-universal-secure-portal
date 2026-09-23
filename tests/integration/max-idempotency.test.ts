import test from 'node:test';
import assert from 'node:assert/strict';

import type { PortalEvent } from '../../src/portal/contracts.js';
import { PortalMetrics } from '../../src/observability/metrics.js';
import { processMaxEvent } from '../../src/platform/max/update-processor.js';

const event: PortalEvent = {
  eventId: 'max_fixture_1',
  kind: 'message',
  principal: { userId: 42, role: 'user' },
  payload: { type: 'message', text: 'hello' },
  receivedAt: new Date('2026-01-01T00:00:00.000Z'),
};

test('duplicate MAX deliveries do not repeat application side effects', async () => {
  const statuses = new Map<string, 'processing' | 'processed' | 'failed'>();
  const storage = {
    updateInbox: {
      async reserve(key: string) {
        const status = statuses.get(key);
        if (!status) {
          statuses.set(key, 'processing');
          return { eventKey: key, status: 'processing' as const, duplicate: false };
        }
        return { eventKey: key, status, duplicate: true };
      },
      async markProcessed(key: string) { statuses.set(key, 'processed'); },
      async markFailed(key: string) { statuses.set(key, 'failed'); },
    },
  };
  let sideEffects = 0;
  const metrics = new PortalMetrics();
  const handle = async () => { sideEffects += 1; };

  assert.equal(await processMaxEvent(event, handle, { storage, metrics }), 'processed');
  assert.equal(await processMaxEvent(event, handle, { storage, metrics }), 'duplicate');
  assert.equal(sideEffects, 1);
  assert.equal(metrics.snapshot().max_update_duplicate_total, 1);
  assert.equal(metrics.snapshot().webhook_duplicates_total, 1);
});

test('failed MAX delivery is recorded and can be retried by the repository policy', async () => {
  const statuses = new Map<string, 'processing' | 'processed' | 'failed'>();
  let attempts = 0;
  const storage = {
    updateInbox: {
      async reserve(key: string) {
        const status = statuses.get(key);
        if (!status || status === 'failed') {
          statuses.set(key, 'processing');
          return { eventKey: key, status: 'processing' as const, duplicate: false };
        }
        return { eventKey: key, status, duplicate: true };
      },
      async markProcessed(key: string) { statuses.set(key, 'processed'); },
      async markFailed(key: string) { statuses.set(key, 'failed'); },
    },
  };
  const handle = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('transient');
  };

  assert.equal(await processMaxEvent(event, handle, { storage }), 'failed');
  assert.equal(await processMaxEvent(event, handle, { storage }), 'processed');
  assert.equal(attempts, 2);
});
