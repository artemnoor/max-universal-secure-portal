import test from 'node:test';
import assert from 'node:assert/strict';

import { configuredOrigin, configuredOrigins } from '../../src/core/url-policy.js';

test('configured URL allowlists compare origins while preserving endpoint paths elsewhere', () => {
  assert.equal(configuredOrigin('https://admin.example.com/admin'), 'https://admin.example.com');
  assert.equal(configuredOrigin('http://localhost:8787/workspace'), 'http://localhost:8787');
  assert.equal(configuredOrigin('javascript:alert(1)'), undefined);
  assert.deepEqual(
    configuredOrigins(['https://admin.example.com/admin', 'https://admin.example.com/other', 'not-a-url']),
    ['https://admin.example.com'],
  );
});
