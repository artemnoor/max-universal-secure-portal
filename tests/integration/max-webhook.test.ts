import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';

import { withWebhookGuard } from '../../src/platform/max/webhook.js';
import { PortalMetrics } from '../../src/observability/metrics.js';

type FakeResponse = {
  status?: number;
  body?: string;
  writeHead: (status: number) => void;
  end: (body?: string) => void;
};

const response = (): FakeResponse => ({
  writeHead(status) { this.status = status; },
  end(body) { this.body = body; },
});

const request = (url: string, secret: string, body = '{}', withContentLength = true): PassThrough & { method: string; url: string; headers: Record<string, string> } => {
  const stream = new PassThrough() as PassThrough & { method: string; url: string; headers: Record<string, string> };
  stream.method = 'POST';
  stream.url = url;
  stream.headers = {
    'x-max-bot-api-secret': secret,
    ...(withContentLength ? { 'content-length': String(Buffer.byteLength(body)) } : {}),
  };
  process.nextTick(() => stream.end(body));
  return stream;
};

test('webhook guard rejects wrong path/secret and limits body before SDK callback', async () => {
  let sdkCalls = 0;
  const metrics = new PortalMetrics();
  const callback = withWebhookGuard(
    () => { sdkCalls += 1; },
    { path: '/max/webhook', secret: 'secret', maxBodyBytes: 16, metrics },
  );

  const wrongPathResponse = response();
  callback(request('/wrong', 'secret') as unknown as IncomingMessage, wrongPathResponse as unknown as ServerResponse);
  assert.equal(wrongPathResponse.status, 404);

  const wrongSecretResponse = response();
  callback(request('/max/webhook', 'wrong') as unknown as IncomingMessage, wrongSecretResponse as unknown as ServerResponse);
  assert.equal(wrongSecretResponse.status, 404);

  const oversizedResponse = response();
  callback(request('/max/webhook', 'secret', 'x'.repeat(17)) as unknown as IncomingMessage, oversizedResponse as unknown as ServerResponse);
  assert.equal(oversizedResponse.status, 413);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sdkCalls, 0);

  const streamedOversizedResponse = response();
  callback(request('/max/webhook', 'secret', 'x'.repeat(17), false) as unknown as IncomingMessage, streamedOversizedResponse as unknown as ServerResponse);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(streamedOversizedResponse.status, 413);
  assert.equal(sdkCalls, 0);

  const validResponse = response();
  callback(request('/max/webhook', 'secret', '{}') as unknown as IncomingMessage, validResponse as unknown as ServerResponse);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sdkCalls, 1);
  assert.equal(metrics.snapshot()['webhook_failures_total{status=404}'], 2);
  assert.equal(metrics.snapshot()['webhook_failures_total{status=413}'], 2);
});

test('webhook guard converts a synchronous SDK callback failure to a safe 500', async () => {
  const metrics = new PortalMetrics();
  const callback = withWebhookGuard(
    () => { throw new Error('fixture callback failure'); },
    { path: '/max/webhook', secret: 'secret', metrics },
  );
  const failedResponse = response();
  callback(request('/max/webhook', 'secret') as unknown as IncomingMessage, failedResponse as unknown as ServerResponse);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failedResponse.status, 500);
  assert.equal(failedResponse.body, 'Internal Server Error');
  assert.equal(metrics.snapshot()['webhook_failures_total{status=500}'], 1);
});
