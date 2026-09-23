export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;
  constructor(message: string, options?: { code?: string; status?: number; requestId?: string });
}

export function toClientErrorMessage(error: unknown, fallback?: string): string;
export function getMaxBridge(): Record<string, unknown> | null;
export function api(path: string, options?: Record<string, unknown>): Promise<unknown>;
