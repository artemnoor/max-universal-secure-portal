import type { ModuleCatalog } from './module-registry.js';
import type { ModuleCallbackActionDefinition, ModuleCommand } from './module-contracts.js';
import type { PortalHttpContent } from './ports/http-content.js';

/** Adapters used by hosts; the catalog remains the single source of truth. */
export const createModuleHttpContent = (catalog: ModuleCatalog): PortalHttpContent => Object.freeze({
  routes: () => catalog.httpRoutes,
});

export const moduleCallbackDefinitions = (catalog: ModuleCatalog): readonly ModuleCallbackActionDefinition[] => catalog.callbackDefinitions;
export const moduleCommands = (catalog: ModuleCatalog): readonly ModuleCommand[] => catalog.commands;
