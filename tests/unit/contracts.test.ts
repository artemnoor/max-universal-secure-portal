import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  portalActionSchema,
  portalEventSchema,
  portalPrincipalSchema,
  portalResponseSchema,
} from '../../src/portal/contracts.js';

test('portal response accepts only declared action variants', () => {
  const parsed = portalResponseSchema.parse({
    text: 'Module response',
    actions: [
      { kind: 'callback', label: 'Run', actionId: 'module:run', data: 'resource-1' },
      { kind: 'open_app', label: 'Open', startParam: 'module' },
      { kind: 'link', label: 'Docs', url: 'https://example.com/help' },
    ],
  });

  assert.equal(parsed.actions.length, 3);
});

test('portal response rejects unknown action kinds and arbitrary fields', () => {
  assert.throws(() => portalActionSchema.parse({
    kind: 'redirect',
    label: 'Unsafe',
    url: 'javascript:alert(1)',
  }));
  assert.throws(() => portalActionSchema.parse({
    kind: 'link',
    label: 'Insecure',
    url: 'http://example.com/help',
  }));

  assert.throws(() => portalPrincipalSchema.parse({
    userId: 42,
    role: 'user',
    isAdmin: true,
  }));
});

test('portal event keeps the authenticated principal separate from payload', () => {
  const event = portalEventSchema.parse({
    eventId: 'update-42',
    kind: 'message',
    principal: { userId: 42, role: 'user' },
    payload: { text: 'Найди программы' },
    receivedAt: '2026-09-23T10:00:00.000Z',
  });

  assert.equal(event.principal.userId, 42);
  assert.equal(event.principal.role, 'user');
  assert.ok(event.receivedAt instanceof Date);
});
