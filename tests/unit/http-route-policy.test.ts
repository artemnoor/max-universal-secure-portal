import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresPrincipal } from '../../src/http/route-policy.js';
test('core route policy does not invent module routes', () => { assert.equal(requiresPrincipal('GET', '/api/v1/health'), false); assert.equal(requiresPrincipal('POST', '/api/v1/custom'), false); });

