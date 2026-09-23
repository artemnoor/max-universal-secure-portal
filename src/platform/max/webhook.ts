import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';

import type { Logger } from '../../core/logger.js';
import type { PortalMetrics } from '../../observability/metrics.js';

export type GuardedWebhookOptions = Readonly<{
  path: string;
  secret?: string;
  maxBodyBytes?: number;
  logger?: Logger;
  metrics?: PortalMetrics;
}>;

const headerValue = (value: string | string[] | undefined): string | undefined => (
  Array.isArray(value) ? value[0] : value
);

const safeSecretEqual = (expected: string, actual: string | undefined): boolean => {
  if (!actual) return false;
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(actual, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};

const discardRequest = (request: IncomingMessage): void => {
  request.resume();
};

const replayRequest = (request: IncomingMessage, body: Buffer): IncomingMessage => {
  const replay = new PassThrough();
  Object.assign(replay, {
    method: request.method,
    url: request.url,
    headers: request.headers,
    rawHeaders: request.rawHeaders,
    httpVersion: request.httpVersion,
    httpVersionMajor: request.httpVersionMajor,
    httpVersionMinor: request.httpVersionMinor,
    socket: request.socket,
  });
  replay.end(body);
  return replay as unknown as IncomingMessage;
};

export const withWebhookGuard = (
  sdkCallback: (request: IncomingMessage, response: ServerResponse) => void,
  options: GuardedWebhookOptions,
): ((request: IncomingMessage, response: ServerResponse) => void) => {
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  const recordFailure = (status: number): void => options.metrics?.increment('webhook_failures_total', { status: String(status) });
  return (request, response) => {
    if (request.method !== 'POST' || request.url !== options.path) {
      recordFailure(404);
      discardRequest(request);
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    if (options.secret && !safeSecretEqual(options.secret, headerValue(request.headers['x-max-bot-api-secret']))) {
      recordFailure(404);
      discardRequest(request);
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    const contentLength = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      recordFailure(413);
      request.resume();
      response.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Payload Too Large');
      return;
    }

    let received = 0;
    let rejected = false;
    const chunks: Buffer[] = [];
    const rejectOversized = (): void => {
      if (rejected) return;
      rejected = true;
      recordFailure(413);
      response.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Payload Too Large');
      request.destroy();
    };
    request.on('data', (chunk: Buffer | string) => {
      if (rejected) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.length;
      if (received > maxBodyBytes) {
        rejectOversized();
        return;
      }
      chunks.push(buffer);
    });
    request.once('error', () => {
      if (rejected) return;
      rejected = true;
      recordFailure(400);
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Bad Request');
      }
    });
    request.once('end', () => {
      if (rejected) return;
      try {
        sdkCallback(replayRequest(request, Buffer.concat(chunks)), response);
      } catch (error) {
        recordFailure(500);
        options.logger?.error({ error }, 'MAX Webhook callback failed');
        if (!response.headersSent && !response.destroyed) {
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Internal Server Error');
        }
      }
    });
  };
};
