import assert from 'node:assert/strict';
import test from 'node:test';

import { PortalMetrics } from '../../src/observability/metrics.js';

test('metrics use bounded labels and never retain arbitrary user input', () => {
  const metrics = new PortalMetrics();
  metrics.increment('http_requests_total', { status: '200' });
  metrics.increment('http_requests_total', { status: 'user phone +7 999 000 00 00' });
  metrics.observe('max_api_latency_ms', 12, { operation: 'max.GET._me' });
  assert.deepEqual(metrics.snapshot(), {
    'http_requests_total{status=200}': 1,
    'http_requests_total{status=other}': 1,
    'max_api_latency_ms{operation=max.GET._me}_count': 1,
    'max_api_latency_ms{operation=max.GET._me}_sum': 12,
  });
  assert.doesNotMatch(metrics.prometheus(), /999|phone/u);
  assert.match(metrics.prometheus(), /max_api_latency_ms_count\{operation="max.GET._me"\} 1/u);
});
