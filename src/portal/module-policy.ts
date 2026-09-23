import { AppError, ERROR_CODES } from '../core/errors.js';
import type { ModuleCapability, ModuleManifest } from './module-contracts.js';
import { MODULE_CAPABILITIES } from './module-contracts.js';

export const DEFAULT_MODULE_CAPABILITIES: ReadonlySet<string> = new Set(MODULE_CAPABILITIES.filter((capability) => capability !== 'pii.read' && capability !== 'pii.write'));

export const assertDeclaredCapability = (manifest: ModuleManifest, capability: ModuleCapability): void => {
  if (!manifest.requiredCapabilities.includes(capability)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Интеграционная возможность модуля не объявлена.');
};

export const hasAllCapabilities = (manifest: ModuleManifest, capabilities: ReadonlySet<string>): boolean => manifest.requiredCapabilities.every((capability) => capabilities.has(capability));
