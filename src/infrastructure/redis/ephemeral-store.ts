import { createHmac, randomBytes } from 'node:crypto';

import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { EphemeralStore } from '../../portal/ports/ephemeral.js';

const MAX_KEY_LENGTH = 256;
const assertTtl = (ttlSeconds: number): void => {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'TTL имеет недопустимое значение.');
  }
};

const assertKey = (key: string): void => {
  if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(key) || key.length > MAX_KEY_LENGTH) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Ключ временного хранилища имеет недопустимый формат.');
  }
};

type MemoryEntry = Readonly<{ value: string; expiresAt: number }>;

const INCREMENT_WINDOW_SCRIPT = [
  'local count = redis.call("incr", KEYS[1])',
  'if count == 1 then redis.call("expire", KEYS[1], ARGV[1]) end',
  'return count',
].join('\n');

export class InMemoryEphemeralStore implements EphemeralStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly windowCounts = new Map<string, { count: number; expiresAt: number }>();
  private readonly locks = new Map<string, MemoryEntry>();

  private namespaced(key: string): string {
    assertKey(key);
    return `memory:${key}`;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
    for (const [key, entry] of this.windowCounts) if (entry.expiresAt <= now) this.windowCounts.delete(key);
    for (const [key, entry] of this.locks) if (entry.expiresAt <= now) this.locks.delete(key);
  }

  async setNxWithTtl(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    assertTtl(ttlSeconds);
    const namespacedKey = this.namespaced(key);
    this.cleanup();
    if (this.entries.has(namespacedKey)) return false;
    this.entries.set(namespacedKey, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async consumeOnce(key: string, ttlSeconds: number): Promise<boolean> {
    return this.setNxWithTtl(`once:${key}`, '1', ttlSeconds);
  }

  async get(key: string): Promise<string | undefined> {
    const namespacedKey = this.namespaced(key);
    this.cleanup();
    return this.entries.get(namespacedKey)?.value;
  }

  async incrementWindow(key: string, windowSeconds: number): Promise<number> {
    assertTtl(windowSeconds);
    const namespacedKey = this.namespaced(`window:${key}`);
    this.cleanup();
    const current = this.windowCounts.get(namespacedKey);
    if (!current) {
      this.windowCounts.set(namespacedKey, { count: 1, expiresAt: Date.now() + windowSeconds * 1000 });
      return 1;
    }
    current.count += 1;
    return current.count;
  }

  async acquireUserLock(userId: number, ttlSeconds: number): Promise<string | undefined> {
    assertTtl(ttlSeconds);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Идентификатор пользователя недействителен.');
    this.cleanup();
    const key = `user-lock:${userId}`;
    if (this.locks.has(key)) return undefined;
    const token = randomBytes(16).toString('hex');
    this.locks.set(key, { value: token, expiresAt: Date.now() + ttlSeconds * 1000 });
    return token;
  }

  async releaseUserLock(userId: number, lockToken: string): Promise<boolean> {
    const key = `user-lock:${userId}`;
    const entry = this.locks.get(key);
    if (!entry || entry.value !== lockToken) return false;
    this.locks.delete(key);
    return true;
  }

  async close(): Promise<void> {
    this.entries.clear();
    this.windowCounts.clear();
    this.locks.clear();
  }
}

export type RedisCommands = Readonly<{
  set(key: string, value: string, mode: 'EX', ttlSeconds: number, condition?: 'NX'): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(script: string, keyCount: number, ...args: string[]): Promise<number>;
  ping?(): Promise<string>;
  quit(): Promise<unknown>;
}>;

const namespaceKey = (namespace: string, key: string, salt: string): string => {
  assertKey(key);
  const digest = createHmac('sha256', salt || 'development-ephemeral-key').update(key).digest('hex').slice(0, 32);
  return `${namespace}:${digest}`;
};

export class RedisEphemeralStore implements EphemeralStore {
  constructor(
    private readonly redis: RedisCommands,
    private readonly namespace: string,
    private readonly salt: string,
  ) {}

  async setNxWithTtl(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    assertTtl(ttlSeconds);
    const result = await this.redis.set(namespaceKey(this.namespace, key, this.salt), value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async consumeOnce(key: string, ttlSeconds: number): Promise<boolean> {
    return this.setNxWithTtl(`once:${key}`, '1', ttlSeconds);
  }

  async get(key: string): Promise<string | undefined> {
    const value = await this.redis.get(namespaceKey(this.namespace, key, this.salt));
    return value ?? undefined;
  }

  async incrementWindow(key: string, windowSeconds: number): Promise<number> {
    assertTtl(windowSeconds);
    const namespacedKey = namespaceKey(this.namespace, `window:${key}`, this.salt);
    return this.redis.eval(INCREMENT_WINDOW_SCRIPT, 1, namespacedKey, String(windowSeconds));
  }

  async acquireUserLock(userId: number, ttlSeconds: number): Promise<string | undefined> {
    const token = randomBytes(16).toString('hex');
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Идентификатор пользователя недействителен.');
    }
    const acquired = await this.setNxWithTtl(`user-lock:${userId}`, token, ttlSeconds);
    return acquired ? token : undefined;
  }

  async releaseUserLock(userId: number, lockToken: string): Promise<boolean> {
    const key = namespaceKey(this.namespace, `user-lock:${userId}`, this.salt);
    const deleted = await this.redis.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      1,
      key,
      lockToken,
    );
    return deleted === 1;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
