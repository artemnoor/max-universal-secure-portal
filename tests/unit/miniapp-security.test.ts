import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRouteHash, safeDecode } from '../../miniapp/js/router.js';
test('generic route parser accepts bounded extension segments', () => { assert.deepEqual(parseRouteHash('#/module/resource'), { view: 'module', parts: ['resource'] }); assert.deepEqual(parseRouteHash('#/unknown/../../secret'), { view: 'unknown', parts: ['secret'] }); });
test('route decoder rejects malformed or oversized values', () => { assert.equal(safeDecode('%'), ''); assert.equal(safeDecode('x'.repeat(129)), ''); });

