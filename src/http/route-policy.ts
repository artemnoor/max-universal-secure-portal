export type ApiRoutePolicy = Readonly<{ method: string; prefix: string; access: 'public' | 'principal' }>;

/** The core only owns health. Feature routes declare their own access in a module. */
export const apiRoutePolicies: readonly ApiRoutePolicy[] = Object.freeze([
  { method: 'GET', prefix: '/api/v1/health', access: 'public' },
]);

export const requiresPrincipal = (method: string | undefined, pathname: string): boolean => apiRoutePolicies.some(
  (policy) => policy.method === method && policy.access === 'principal' && pathname.startsWith(policy.prefix),
);
