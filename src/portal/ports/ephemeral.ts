export interface EphemeralStore {
  setNxWithTtl(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  get(key: string): Promise<string | undefined>;
  consumeOnce(key: string, ttlSeconds: number): Promise<boolean>;
  incrementWindow(key: string, windowSeconds: number): Promise<number>;
  acquireUserLock(userId: number, ttlSeconds: number): Promise<string | undefined>;
  releaseUserLock(userId: number, lockToken: string): Promise<boolean>;
  close(): Promise<void>;
}
