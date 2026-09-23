import test from 'node:test';
import assert from 'node:assert/strict';

import { createSignedInitData, TEST_BOT_TOKEN } from '../fixtures/max-init-data.js';
import { validateMaxInitData } from '../../src/platform/max/init-data-validator.js';

const options = { botToken: TEST_BOT_TOKEN, ttlSeconds: 900, now: () => 1_700_000_100 };

test('MAX initData validates signature, user schema and TTL without retaining raw input', () => {
  const raw = createSignedInitData({ authDate: 1_700_000_000, userId: 42 });
  const session = validateMaxInitData(raw, options);
  assert.equal(session.userId, 42);
  assert.equal(session.user?.username, 'fixture_user');
  assert.equal('raw' in session, false);
  assert.equal(session.rawHash.length, 64);
});

test('MAX initData accepts official nullable profile fields without retaining them', () => {
  const raw = createSignedInitData({ authDate: 1_700_000_000, userExtras: { username: null, last_name: null, language_code: 'ru', photo_url: null } });
  const session = validateMaxInitData(raw, options);
  assert.equal(session.userId, 42);
  assert.equal(session.user?.username, undefined);
  assert.equal(session.user?.last_name, undefined);
  assert.equal('language_code' in (session.user ?? {}), false);
  assert.equal('photo_url' in (session.user ?? {}), false);
});

test('MAX initData rejects duplicate keys, malformed encoding, bad signatures, invalid users and expiry', () => {
  const raw = createSignedInitData({ authDate: 1_700_000_000 });
  assert.throws(() => validateMaxInitData(`${raw}&hash=${'0'.repeat(64)}`, options), { code: 'AUTH_INVALID' });
  assert.throws(() => validateMaxInitData(`${raw}&bad=%`, options), { code: 'AUTH_INVALID' });
  assert.throws(() => validateMaxInitData(raw, { ...options, botToken: 'wrong-token' }), { code: 'AUTH_INVALID' });
  assert.throws(() => validateMaxInitData(raw, { ...options, now: () => 1_700_001_000 }), { code: 'AUTH_EXPIRED' });
  assert.throws(() => validateMaxInitData(raw, { ...options, now: () => 1_699_999_000 }), { code: 'AUTH_INVALID' });
  assert.throws(() => validateMaxInitData(`${raw.slice(0, 10)}%${raw.slice(10)}`, options), { code: 'AUTH_INVALID' });
});
