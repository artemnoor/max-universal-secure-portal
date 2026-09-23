import type { ModuleCatalog } from './module-registry.js';

export type PortalModuleSummary = Readonly<{
  id: string;
  version: number;
  publicName: string;
}>;

export type PortalInfo = Readonly<{
  name: 'MAX Portal';
  contractVersion: 1;
  modules: readonly PortalModuleSummary[];
}>;

/** Public, transport-neutral metadata for the generic Mini App shell. */
export const createPortalInfo = (catalog: ModuleCatalog): PortalInfo => Object.freeze({
  name: 'MAX Portal',
  contractVersion: 1,
  modules: Object.freeze(catalog.modules.map(({ manifest }) => Object.freeze({
    id: manifest.id,
    version: manifest.version,
    publicName: manifest.publicName,
  }))),
});
