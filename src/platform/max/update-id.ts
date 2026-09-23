import { createHash } from 'node:crypto';

import type { PortalEvent } from '../../portal/contracts.js';

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(',')}}`;
};

export const createUpdateEventKey = (event: Pick<PortalEvent, 'eventId' | 'kind' | 'principal' | 'payload'>): string => {
  const source = event.eventId || `${event.kind}:${event.principal.userId}:${stableJson(event.payload)}`;
  return `max:${createHash('sha256').update(source).digest('hex').slice(0, 48)}`;
};

