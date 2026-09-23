import { createHash } from 'node:crypto';
import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { PortalPrincipal } from '../../core/principal.js';
import type { ModuleCallbackActionDefinition } from '../../portal/module-contracts.js';

export const MAX_CALLBACK_PAYLOAD_BYTES = 1024;
export type CallbackAction = Readonly<{ namespace: string; verb: string; resource?: string; raw: string }>;
export type CallbackActionDefinition = ModuleCallbackActionDefinition & Readonly<{ authorize?: (action: CallbackAction, principal: PortalPrincipal) => Promise<boolean> | boolean }>;
const ACTION_PART = /^[a-z][a-z0-9_-]{0,31}$/u;
const RESOURCE_PART = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const invalidAction = (message: string): AppError => new AppError(ERROR_CODES.VALIDATION_FAILED, 400, message);

export const parseCallbackAction = async (raw: unknown, definitions: readonly CallbackActionDefinition[], principal: PortalPrincipal): Promise<CallbackAction> => {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_CALLBACK_PAYLOAD_BYTES) throw invalidAction('Callback имеет недопустимый формат.');
  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !part)) throw invalidAction('Callback имеет недопустимый формат.');
  const [namespace, verb, resource] = parts;
  if (!ACTION_PART.test(namespace) || !ACTION_PART.test(verb) || (resource !== undefined && !RESOURCE_PART.test(resource))) throw invalidAction('Callback имеет недопустимый формат.');
  const definition = definitions.find((candidate) => candidate.namespace === namespace && candidate.verb === verb);
  if (!definition || Boolean(definition.requiresResource) !== Boolean(resource)) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Действие недоступно.');
  const action = { namespace, verb, ...(resource ? { resource } : {}), raw };
  if (definition.authorize && !await definition.authorize(action, principal)) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Действие недоступно.');
  return action;
};
export const callbackTokenHash = (raw: string): string => createHash('sha256').update(raw).digest('hex').slice(0, 16);
export const callbackActionDefinitions = (extra: readonly CallbackActionDefinition[] = []): readonly CallbackActionDefinition[] => [...extra];
