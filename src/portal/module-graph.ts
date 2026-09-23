import { AppError, ERROR_CODES } from '../core/errors.js';
import type { ModuleDefinition } from './module-contracts.js';

export const resolveModuleOrder = (definitions: ReadonlyMap<string, ModuleDefinition>): readonly string[] => {
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const [id, definition] of definitions) {
    const required = new Set(definition.manifest.dependsOn.map((dependency) => dependency.id));
    dependencies.set(id, required);
    for (const dependencyId of required) {
      if (!definitions.has(dependencyId)) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Зависимость модуля не зарегистрирована.');
      const consumers = dependents.get(dependencyId) ?? new Set<string>();
      consumers.add(id);
      dependents.set(dependencyId, consumers);
    }
  }

  const ready = [...dependencies.entries()].filter(([, required]) => required.size === 0).map(([id]) => id).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) continue;
    order.push(id);
    for (const dependentId of dependents.get(id) ?? []) {
      const required = dependencies.get(dependentId);
      required?.delete(id);
      if (required?.size === 0) {
        ready.push(dependentId);
        ready.sort();
      }
    }
  }
  if (order.length !== definitions.size) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Циклическая зависимость модулей запрещена.');
  return Object.freeze(order);
};
