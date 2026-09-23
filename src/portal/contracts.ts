import { z } from 'zod';

import type { PortalPrincipal, RequestContext } from '../core/principal.js';
import type { PortalContext } from './context.js';

export type PortalEventKind = 'message' | 'callback' | 'bot_started' | 'web_app' | 'lifecycle';

export type PortalEvent = Readonly<{
  eventId: string;
  kind: PortalEventKind;
  principal: PortalPrincipal;
  chatId?: number;
  payload: unknown;
  receivedAt: Date;
}>;

export type PortalAction =
  | Readonly<{ kind: 'callback'; label: string; actionId: string; data?: string }>
  | Readonly<{ kind: 'open_app'; label: string; startParam?: string }>
  | Readonly<{ kind: 'link'; label: string; url: string }>;

export type PortalResponse = Readonly<{
  text: string;
  actions: readonly PortalAction[];
  statePatch?: unknown;
}>;

export type PortalActionHandler = (
  event: PortalEvent,
  action: Extract<PortalAction, { kind: 'callback' }>,
  context: RequestContext,
) => Promise<PortalResponse>;

export type PortalModuleContext = Readonly<{
  request: RequestContext;
  state: Readonly<Record<string, unknown>>;
  portal?: PortalContext;
  handleAction: PortalActionHandler;
}>;

export interface PortalModule {
  readonly id: string;
  readonly version: number;
  canHandle(event: PortalEvent): boolean;
  handle(event: PortalEvent, context: PortalModuleContext): Promise<PortalResponse>;
}

export interface PortalApplication {
  registerModule(module: PortalModule): void;
  handle(event: PortalEvent, request: RequestContext): Promise<PortalResponse>;
  handleMessage(event: PortalEvent, request: RequestContext): Promise<PortalResponse>;
  handleAction(event: PortalEvent, request: RequestContext): Promise<PortalResponse>;
}

export const portalPrincipalSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(['user', 'admin']),
  chatId: z.number().int().positive().optional(),
}).strict();

const callbackActionSchema = z.object({
  kind: z.literal('callback'),
  label: z.string().trim().min(1).max(128),
  actionId: z.string().trim().min(1).max(128),
  data: z.string().max(512).optional(),
}).strict();

const openAppActionSchema = z.object({
  kind: z.literal('open_app'),
  label: z.string().trim().min(1).max(128),
  startParam: z.string().max(512).optional(),
}).strict();

const linkActionSchema = z.object({
  kind: z.literal('link'),
  label: z.string().trim().min(1).max(128),
  url: z.string().url().refine((value) => value.startsWith('https://'), {
    message: 'link action URL must use https',
  }),
}).strict();

export const portalActionSchema = z.discriminatedUnion('kind', [
  callbackActionSchema,
  openAppActionSchema,
  linkActionSchema,
]);

export const portalResponseSchema = z.object({
  text: z.string().max(4096),
  actions: z.array(portalActionSchema).max(210),
  statePatch: z.unknown().optional(),
}).strict();

export const portalEventSchema = z.object({
  eventId: z.string().trim().min(1).max(256),
  kind: z.enum(['message', 'callback', 'bot_started', 'web_app', 'lifecycle']),
  principal: portalPrincipalSchema,
  chatId: z.number().int().positive().optional(),
  payload: z.unknown(),
  receivedAt: z.coerce.date(),
}).strict();
