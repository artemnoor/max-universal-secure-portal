import type { PortalPrincipal } from '../../core/principal.js';
import type { UpdateInboxRepository, UpdateInboxReservation, UpdateInboxReserveOptions } from '../../portal/ports/storage.js';

type Entry = { status: 'received' | 'processing' | 'processed' | 'failed'; attempts: number; failedAt?: number };

/** Development/test-only duplicate guard. Production uses the PostgreSQL inbox. */
export class InMemoryUpdateInbox implements UpdateInboxRepository {
  private readonly entries = new Map<string, Entry>();

  async reserve(eventKey: string, _principal: PortalPrincipal, options: UpdateInboxReserveOptions = {}): Promise<UpdateInboxReservation> {
    const existing = this.entries.get(eventKey);
    if (!existing) {
      this.entries.set(eventKey, { status: 'processing', attempts: 1 });
      return { eventKey, status: 'processing', duplicate: false };
    }
    const retryAfter = (options.retryFailedAfterSeconds ?? 30) * 1000;
    if (existing.status === 'failed' && existing.failedAt !== undefined && Date.now() - existing.failedAt >= retryAfter) {
      existing.status = 'processing';
      existing.attempts += 1;
      existing.failedAt = undefined;
      return { eventKey, status: 'processing', duplicate: false };
    }
    return { eventKey, status: existing.status, duplicate: true };
  }

  async markProcessed(eventKey: string): Promise<void> {
    const entry = this.entries.get(eventKey);
    if (entry) entry.status = 'processed';
  }

  async markFailed(eventKey: string, _errorCode: string): Promise<void> {
    const entry = this.entries.get(eventKey);
    if (entry) {
      entry.status = 'failed';
      entry.failedAt = Date.now();
    }
  }
}
