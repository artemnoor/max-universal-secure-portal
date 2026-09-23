import { AppError, ERROR_CODES } from '../core/errors.js';

const SERVICE_ID = /^[a-z][a-z0-9.-]{0,63}$/u;
const EVENT_NAME = /^[a-z][a-z0-9-]{0,31}\.[a-z][a-z0-9.-]{0,31}$/u;

export type ModuleServiceToken<T> = Readonly<{
  id: string;
  version: number;
  readonly __service?: T;
}>;

export const createModuleServiceToken = <T>(id: string, version = 1): ModuleServiceToken<T> => {
  if (!SERVICE_ID.test(id) || !Number.isSafeInteger(version) || version < 1) {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Идентификатор сервиса модуля настроен некорректно.');
  }
  return Object.freeze({ id, version });
};

export interface ModuleServiceResolver {
  resolve<T>(token: ModuleServiceToken<T>): T;
}

export type ModuleEventEnvelope = Readonly<{
  name: string;
  version: number;
  moduleId: string;
  payload: unknown;
}>;

export interface ModuleEventPublisher {
  publish(event: ModuleEventEnvelope): Promise<void>;
}

export const assertModuleEventEnvelope = (event: ModuleEventEnvelope): void => {
  if (!EVENT_NAME.test(event.name) || !/^[a-z][a-z0-9-]{0,31}$/u.test(event.moduleId) || !event.name.startsWith(`${event.moduleId}.`) || Buffer.byteLength(event.name, 'utf8') > 64) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Событие модуля имеет недопустимый формат.');
  }
  if (!Number.isSafeInteger(event.version) || event.version < 1) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Версия события модуля имеет недопустимый формат.');
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(event.payload);
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Данные события модуля имеют недопустимый формат.');
  }
  if (serialized === undefined) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Данные события модуля имеют недопустимый формат.');
  if (Buffer.byteLength(serialized, 'utf8') > 8 * 1024) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Данные события модуля слишком большие.');
  }
};
