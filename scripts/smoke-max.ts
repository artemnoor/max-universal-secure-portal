import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { isSafeHostname } from '../src/core/url-policy.js';
import { createMaxApiFetch, MaxApiClient } from '../src/platform/max/max-api-client.js';
import { DEFAULT_ALLOWED_UPDATES } from '../src/platform/max/create-max-bot.js';

const fail = (message: string): never => { throw new Error(message); };

export const createSignedInitData = (botToken: string, userId: number, authDate = Math.floor(Date.now() / 1000)): string => {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id: userId, first_name: 'Staging smoke', username: 'staging_smoke' }),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
  return params.toString();
};

export const runSmoke = async (
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<void> => {
  const configuredBaseUrl = environment.SMOKE_BASE_URL?.trim();
  const botToken = environment.SMOKE_BOT_TOKEN;
  const smokeUserId = Number(environment.SMOKE_USER_ID ?? 0);
  const allowMutation = environment.SMOKE_ALLOW_MUTATION === 'true';
  const configuredMaxApiBaseUrl = (environment.SMOKE_MAX_API_BASE_URL ?? 'https://platform-api2.max.ru').trim();

  if (!configuredBaseUrl) {
    console.log('MAX staging smoke skipped: set SMOKE_BASE_URL to an approved staging HTTPS origin.');
    return;
  }

  const parsedBaseUrl = new URL(configuredBaseUrl);
  if (parsedBaseUrl.protocol !== 'https:' || parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.pathname !== '/' || parsedBaseUrl.search || parsedBaseUrl.hash || !isSafeHostname(parsedBaseUrl.hostname)) {
    fail('SMOKE_BASE_URL must be a clean HTTPS origin without credentials, path, query or fragment');
  }
  const baseUrl = parsedBaseUrl.origin;
  const parsedMaxApiBaseUrl = new URL(configuredMaxApiBaseUrl);
  if (parsedMaxApiBaseUrl.protocol !== 'https:' || parsedMaxApiBaseUrl.username || parsedMaxApiBaseUrl.password || parsedMaxApiBaseUrl.search || parsedMaxApiBaseUrl.hash || !isSafeHostname(parsedMaxApiBaseUrl.hostname)) {
    fail('SMOKE_MAX_API_BASE_URL must use HTTPS, a safe hostname, and no credentials, query or fragment');
  }
  const maxApiBaseUrl = parsedMaxApiBaseUrl.href.replace(/\/$/u, '');

  const checkPortal = async (path: string, initData?: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set('accept', 'application/json');
    if (initData) headers.set('x-max-init-data', initData);
    return fetcher(`${baseUrl}${path}`, { ...init, headers });
  };

  const expectStatus = async (path: string, expected: number, initData?: string, init?: RequestInit): Promise<Response> => {
    const response = await checkPortal(path, initData, init);
    if (response.status !== expected) fail(`${path} returned unexpected status ${response.status}; expected ${expected}`);
    return response;
  };

  const maxFetch = createMaxApiFetch(new MaxApiClient(), fetcher);
  const maxRead = async (operation: string, path: string): Promise<unknown> => {
    const response = await maxFetch(`${maxApiBaseUrl}${path}`, {
      headers: { authorization: botToken ?? '' },
    });
    if (!response.ok) fail(`MAX ${operation} returned ${response.status}`);
    return response.json() as Promise<unknown>;
  };

  await expectStatus('/health/live', 200);
  await expectStatus('/health/ready', 200);
  const queryAuth = await checkPortal('/api/v1/health?initData=forbidden');
  if (queryAuth.status < 400) fail('query authorization was accepted');
  console.log('Portal health and authorization smoke passed.');

  if (botToken && Number.isSafeInteger(smokeUserId) && smokeUserId > 0) {
    const valid = createSignedInitData(botToken, smokeUserId);
    const tampered = `${valid.slice(0, -1)}${valid.endsWith('0') ? '1' : '0'}`;
    const expired = createSignedInitData(botToken, smokeUserId, Math.floor(Date.now() / 1000) - 86_400);
    await expectStatus('/api/v1/extension-placeholder', 404, tampered);
    await expectStatus('/api/v1/extension-placeholder', 404, expired);
    console.log(`Signed Mini App fixture prepared; module routes remain unregistered${allowMutation ? '.' : ' (set SMOKE_ALLOW_MUTATION=true only for an approved module route).'}`);
  } else {
    console.log('Signed Mini App smoke skipped: set SMOKE_BOT_TOKEN and SMOKE_USER_ID; tamper/expiry checks remain available in staging.');
  }

  if (botToken) {
    await maxRead('max.get_my_info', '/me');
    const subscriptions = await maxRead('max.get_subscriptions', '/subscriptions');
    const records = subscriptions && typeof subscriptions === 'object' && Array.isArray((subscriptions as { subscriptions?: unknown }).subscriptions)
      ? (subscriptions as { subscriptions: unknown[] }).subscriptions
      : [];
    const expectedWebhookUrl = environment.SMOKE_WEBHOOK_URL;
    if (expectedWebhookUrl) {
      const match = records.find((value) => {
        if (!value || typeof value !== 'object') return false;
        const record = value as { url?: unknown; update_types?: unknown; updateTypes?: unknown };
        if (record.url !== expectedWebhookUrl) return false;
        const updateTypes = Array.isArray(record.update_types) ? record.update_types : Array.isArray(record.updateTypes) ? record.updateTypes : [];
        return DEFAULT_ALLOWED_UPDATES.every((type) => updateTypes.includes(type));
      });
      if (!match) fail('MAX subscription does not match SMOKE_WEBHOOK_URL and the required update types');
      console.log('MAX subscription smoke passed (Webhook URL and allowed updates).');
    } else {
      console.log('MAX subscription URL comparison skipped: set SMOKE_WEBHOOK_URL for the expected staging Webhook.');
    }
  } else {
    console.log('MAX API subscription smoke skipped: set SMOKE_BOT_TOKEN for read-only /me and /subscriptions checks.');
  }

  console.log('MAX staging smoke passed. Duplicate Webhook delivery and chat callback remain explicit staging-chat checks.');
};

const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMainModule) {
  void runSmoke().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'MAX staging smoke failed');
    process.exitCode = 1;
  });
}
