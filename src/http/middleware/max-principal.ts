import type { IncomingMessage } from 'node:http';

import type { AppConfig } from '../../core/config.js';
import { AppError, ERROR_CODES } from '../../core/errors.js';
import type { PortalPrincipal } from '../../core/principal.js';
import { validateMaxInitData, type MaxSession } from '../../platform/max/init-data-validator.js';

export const maxInitDataHeader = 'x-max-init-data';

const header = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export const extractMaxSession = (request: IncomingMessage, config: Pick<AppConfig, 'botToken' | 'initDataTtlSeconds' | 'allowUnverifiedMiniApp' | 'devAllowUnverifiedMiniApp' | 'nodeEnv'>): MaxSession => {
  const raw = header(request, maxInitDataHeader);
  if (raw) return validateMaxInitData(raw, { botToken: config.botToken, ttlSeconds: config.initDataTtlSeconds });
  if (config.nodeEnv === 'development' && config.allowUnverifiedMiniApp && config.devAllowUnverifiedMiniApp) {
    const userId = 999999999;
    return {
      userId,
      user: { id: userId, first_name: 'Demo', username: 'local_demo' },
      authDate: Math.floor(Date.now() / 1000),
      sessionFingerprint: 'development-fixture',
      rawHash: 'development-fixture',
    };
  }
  throw new AppError(ERROR_CODES.AUTH_REQUIRED, 401, 'Для Mini App требуется заголовок авторизации.');
};

export const toPortalPrincipal = (
  session: MaxSession,
  adminUserIds: readonly number[],
): PortalPrincipal => ({
  userId: session.userId,
  role: adminUserIds.includes(session.userId) ? 'admin' : 'user',
});
