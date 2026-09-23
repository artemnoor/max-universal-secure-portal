import { AppError, ERROR_CODES } from '../../core/errors.js';
import { Store } from '../../store.js';

/** Development-only adapter for the local JSON FileStore. */
export class FileStore extends Store {
  constructor(dataDir: string) {
    const environment = process.env.NODE_ENV?.trim().toLowerCase() || 'development';
    if ((environment !== 'development' && environment !== 'test') || process.env.DATABASE_URL?.trim()) {
      throw new AppError(
        ERROR_CODES.CONFIG_INVALID,
        500,
        'FileStore разрешён только в development/test без настроенного DATABASE_URL.',
        { details: { environment, storage: 'file', ...(process.env.DATABASE_URL?.trim() ? { reason: 'database_configured' } : {}) } },
      );
    }
    super(dataDir, { allowFileStore: true });
  }
}
