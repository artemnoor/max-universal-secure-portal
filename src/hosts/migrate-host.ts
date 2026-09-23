import type { AppConfig } from '../core/config.js';
import { applyMigrations } from '../infrastructure/postgres/migrate.js';
import type { ModuleCatalog } from '../portal/module-registry.js';

export const runMigrationHost = async (config: AppConfig, catalog?: Pick<ModuleCatalog, 'migrations'>): Promise<void> => {
  await applyMigrations(config, undefined, catalog?.migrations ?? []);
};
