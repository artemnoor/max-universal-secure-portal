import type { IncomingMessage } from 'node:http';

import type { PortalPrincipal } from '../../core/principal.js';

export type PortalHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type PortalHttpAccess = 'public' | 'principal' | 'admin';
export type PortalHttpRouteMatch = string | RegExp | ((method: string, pathname: string) => boolean);
export type PortalHttpRequest = Readonly<{
  request: IncomingMessage;
  url: URL;
  body: unknown;
  requestId: string;
  principal?: PortalPrincipal;
}>;
export type PortalHttpResult = Readonly<{ status?: number; body: unknown; headers?: Readonly<Record<string, string>> }>;
export type PortalHttpRoute = Readonly<{
  method: PortalHttpMethod;
  match: PortalHttpRouteMatch;
  access: PortalHttpAccess;
  handle(input: PortalHttpRequest): Promise<PortalHttpResult> | PortalHttpResult;
}>;
export interface PortalHttpContent { routes(): readonly PortalHttpRoute[]; }
