import { AppError, ERROR_CODES } from '../core/errors.js';
import type { PortalModule } from './contracts.js';
import type { CallbackActionDefinition } from '../platform/max/callback-actions.js';

export type RegisteredPortalModule = Readonly<{
  module: PortalModule;
  actions: readonly CallbackActionDefinition[];
}>;

export class PortalModuleRegistry {
  private readonly modules = new Map<string, RegisteredPortalModule>();

  register(module: PortalModule, actions: readonly CallbackActionDefinition[] = []): void {
    if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(module.id) || !Number.isSafeInteger(module.version) || module.version < 1) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Модуль портала имеет недопустимый контракт.');
    if (this.modules.has(module.id)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Модуль портала зарегистрирован повторно.');
    this.modules.set(module.id, { module, actions: Object.freeze([...actions]) });
  }

  find(event: Parameters<PortalModule['canHandle']>[0]): RegisteredPortalModule | undefined {
    return [...this.modules.values()].find((entry) => entry.module.canHandle(event));
  }

  get(id: string): RegisteredPortalModule | undefined { return this.modules.get(id); }

  all(): readonly RegisteredPortalModule[] { return [...this.modules.values()]; }
}

