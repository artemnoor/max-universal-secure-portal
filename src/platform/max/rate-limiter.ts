import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { EphemeralStore } from '../../portal/ports/ephemeral.js';

export type RateLimiterOptions = Readonly<{
  store?: EphemeralStore;
  key?: string;
  maxRequests?: number;
  windowSeconds?: number;
  now?: () => number;
}>;

export class MaxOutboundRateLimiter {
  private readonly maxRequests: number;
  private readonly windowSeconds: number;
  private readonly now: () => number;
  private localWindow = { startedAt: 0, count: 0 };

  constructor(private readonly options: RateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? 25;
    this.windowSeconds = options.windowSeconds ?? 1;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.maxRequests) || this.maxRequests < 1 || this.maxRequests > 25) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Лимит MAX API недействителен.');
  }

  async acquire(): Promise<void> {
    if (this.options.store) {
      const count = await this.options.store.incrementWindow(this.options.key ?? 'max-api', this.windowSeconds);
      if (count > this.maxRequests) throw new AppError(ERROR_CODES.RATE_LIMITED, 429, 'MAX API временно ограничен.');
      return;
    }
    const now = this.now();
    if (now - this.localWindow.startedAt >= this.windowSeconds * 1000) this.localWindow = { startedAt: now, count: 0 };
    this.localWindow.count += 1;
    if (this.localWindow.count > this.maxRequests) throw new AppError(ERROR_CODES.RATE_LIMITED, 429, 'MAX API временно ограничен.');
  }
}
