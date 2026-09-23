import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../../src/core/errors.js';
import { InMemoryEphemeralStore, RedisEphemeralStore, type RedisCommands } from '../../src/infrastructure/redis/ephemeral-store.js';

test('in-memory ephemeral store consumes a key exactly once', async () => {
  const store = new InMemoryEphemeralStore();

  assert.equal(await store.consumeOnce('update-42', 60), true);
  assert.equal(await store.consumeOnce('update-42', 60), false);
  await store.close();
});

test('in-memory ephemeral store increments windows and protects user locks', async () => {
  const store = new InMemoryEphemeralStore();

  assert.equal(await store.incrementWindow('user-42', 60), 1);
  assert.equal(await store.incrementWindow('user-42', 60), 2);
  const token = await store.acquireUserLock(42, 60);
  assert.ok(token);
  assert.equal(await store.acquireUserLock(42, 60), undefined);
  assert.equal(await store.releaseUserLock(42, 'wrong-token'), false);
  assert.equal(await store.releaseUserLock(42, token), true);
  await store.close();
});

test('ephemeral keys and TTLs are bounded before storage access', async () => {
  const store = new InMemoryEphemeralStore();

  await assert.rejects(store.consumeOnce('raw initData with spaces', 60), AppError);
  await assert.rejects(store.consumeOnce('valid-key', 0), AppError);
  await assert.rejects(store.incrementWindow('valid-key', 90000), AppError);
  await store.close();
});

test('redis rate-limit windows increment and set TTL atomically without raw keys', async () => {
  let count = 0;
  const calls: Array<{ script: string; keyCount: number; args: string[] }> = [];
  const redis: RedisCommands = {
    set: async () => 'OK',
    get: async () => null,
    del: async () => 0,
    eval: async (script, keyCount, ...args) => {
      calls.push({ script, keyCount, args });
      count += 1;
      return count;
    },
    quit: async () => undefined,
  };
  const store = new RedisEphemeralStore(redis, 'integration', 'fixture-salt');

  assert.equal(await store.incrementWindow('user-42', 60), 1);
  assert.equal(await store.incrementWindow('user-42', 60), 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.keyCount, 1);
  assert.equal(calls[0]?.args[1], '60');
  assert.notEqual(calls[0]?.args[0], 'user-42');
  assert.match(calls[0]?.script ?? '', /redis\.call\("incr"/u);
  assert.match(calls[0]?.script ?? '', /redis\.call\("expire"/u);
  await store.close();
});
