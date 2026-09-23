import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { PortalPrincipal } from '../../core/principal.js';
import type { EphemeralStore } from '../../portal/ports/ephemeral.js';

export type DeepLinkTarget = Readonly<{ type: string; id?: string; section?: string }>;
export type DeepLinkIssueInput = Readonly<{ purpose: 'bot_start' | 'miniapp_start'; module: string; principal?: PortalPrincipal; target: DeepLinkTarget; ttlSeconds?: number }>;
export type DeepLinkTokenOptions = Readonly<{ key: string; store: EphemeralStore; now?: () => number; maxLength?: number }>;
type TokenPayload = Readonly<{ v: 1; p: DeepLinkIssueInput['purpose']; m: string; n: string; e: number; s?: number }>;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const base64url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');
const sign = (key: string, value: string): Buffer => createHmac('sha256', key).update(value).digest();
const invalid = (): AppError => new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Deep link имеет недопустимый формат.');
const validateTarget = (value: unknown): DeepLinkTarget => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/u.test(candidate.type)) throw invalid();
  for (const key of ['id', 'section'] as const) if (candidate[key] !== undefined && (typeof candidate[key] !== 'string' || !SAFE.test(candidate[key]))) throw invalid();
  return { type: candidate.type, ...(typeof candidate.id === 'string' ? { id: candidate.id } : {}), ...(typeof candidate.section === 'string' ? { section: candidate.section } : {}) };
};
export class DeepLinkTokenService {
  private readonly now: () => number;
  private readonly maxLength: number;
  constructor(private readonly options: DeepLinkTokenOptions) {
    if (options.key.length < 16) throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Ключ deep link настроен небезопасно.');
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.maxLength = options.maxLength ?? 512;
  }
  async issue(input: DeepLinkIssueInput): Promise<string> {
    const ttl = input.ttlSeconds ?? 300;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 86400 || !/^[a-z][a-z0-9_-]{0,31}$/u.test(input.module)) throw invalid();
    const target = validateTarget(input.target);
    const nonce = randomBytes(18).toString('base64url');
    const encoded = base64url(JSON.stringify({ v: 1, p: input.purpose, m: input.module, n: nonce, e: this.now() + ttl, ...(input.principal ? { s: input.principal.userId } : {}) } satisfies TokenPayload));
    const token = `${encoded}.${base64url(sign(this.options.key, encoded))}`;
    if (token.length > this.maxLength) throw invalid();
    if (!await this.options.store.setNxWithTtl(`deeplink:${nonce}`, JSON.stringify({ target, principalUserId: input.principal?.userId ?? null }), ttl)) throw new AppError(ERROR_CODES.DEPENDENCY_UNAVAILABLE, 503, 'Не удалось создать deep link.');
    return token;
  }
  async consume(token: string, principal: PortalPrincipal, purpose: DeepLinkIssueInput['purpose']): Promise<DeepLinkTarget> {
    if (typeof token !== 'string' || token.length > this.maxLength) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Deep link недействителен.');
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]+$/.test(signature)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Deep link недействителен.');
    const expected = sign(this.options.key, encoded);
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError(ERROR_CODES.AUTH_INVALID, 401, 'Deep link недействителен.');
    let payload: TokenPayload;
    try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload; } catch (error) { throw new AppError(ERROR_CODES.AUTH_INVALID, 401, 'Deep link недействителен.', { cause: error }); }
    if (payload.v !== 1 || payload.p !== purpose || !SAFE.test(payload.m) || !/^[A-Za-z0-9_-]{24,64}$/.test(payload.n) || !Number.isSafeInteger(payload.e) || payload.e < this.now()) throw new AppError(ERROR_CODES.AUTH_EXPIRED, 401, 'Deep link истёк или недействителен.');
    if (payload.s !== undefined && payload.s !== principal.userId) throw new AppError(ERROR_CODES.FORBIDDEN, 403, 'Deep link недоступен.');
    const stored = await this.options.store.get(`deeplink:${payload.n}`);
    if (!stored || !await this.options.store.consumeOnce(`deeplink-consumed:${payload.n}`, Math.max(1, payload.e - this.now()))) throw new AppError(ERROR_CODES.AUTH_INVALID, 401, 'Deep link уже использован или недействителен.');
    try {
      const record = JSON.parse(stored) as { target?: unknown; principalUserId?: unknown };
      if (record.principalUserId !== null && record.principalUserId !== principal.userId) throw new Error('foreign target');
      return validateTarget(record.target);
    } catch (error) { throw new AppError(ERROR_CODES.AUTH_INVALID, 401, 'Deep link недействителен.', { cause: error }); }
  }
}
