import { createServer, type Server } from 'node:http';

import { Bot, Context } from '@maxhub/max-bot-api';

import type { AppConfig } from '../../core/config.js';
import { AppError, errorToLogFields } from '../../core/errors.js';
import { principalHash, type Logger } from '../../core/logger.js';
import { isSafeHostname } from '../../core/url-policy.js';
import type { PortalMetrics } from '../../observability/metrics.js';
import type { PortalEvent, PortalResponse } from '../../portal/contracts.js';
import { normalizeMaxUpdate } from './update-router.js';
import { renderPortalResponseAttachments } from './response-renderer.js';
import { withWebhookGuard } from './webhook.js';
import { createMaxApiFetch, MaxApiClient } from './max-api-client.js';
import { MaxOutboundRateLimiter } from './rate-limiter.js';

export const DEFAULT_ALLOWED_UPDATES = [
  'bot_started',
  'message_created',
  'message_callback',
  'bot_added',
  'user_added',
  'bot_stopped',
  'bot_removed',
] as const;

export const normalizeMaxApiBaseUrl = (value: string): string => value.endsWith('/') ? value : `${value}/`;

const assertSafeMaxApiBaseUrl = (value: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError('CONFIG_INVALID', 500, 'MAX API URL настроен некорректно.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !isSafeHostname(parsed.hostname)) {
    throw new AppError('CONFIG_INVALID', 500, 'MAX API URL настроен небезопасно.');
  }
};

const safeWebhookUrl = (domain: string, path: string): string => {
  if (!isSafeHostname(domain) || !/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,127}$/u.test(path) || path.includes('//') || path.includes('..')) {
    throw new AppError('CONFIG_INVALID', 500, 'Webhook URL настроен некорректно.');
  }
  return `https://${domain}${path}`;
};

export type MaxBotDependencies = Readonly<{
  config: Pick<AppConfig, 'botToken' | 'transport' | 'webhookDomain' | 'webhookPort' | 'webhookPath' | 'webhookSecret'>
    & Partial<Pick<AppConfig, 'maxApiBaseUrl'>>;
  logger: Logger;
  onEvent: (event: PortalEvent) => Promise<PortalResponse | void>;
  renderResponse?: (context: Context, response: PortalResponse) => Promise<void>;
  isAdmin?: (userId: number) => boolean;
  now?: () => Date;
  maxApiLimiter?: MaxOutboundRateLimiter;
  metrics?: PortalMetrics;
}>;

export type MaxBotCommand = Readonly<{
  name: string;
  description: string;
}>;

export type MaxBotAdapter = Readonly<{
  bot: Bot;
  start(): Promise<void>;
  webhookCallback(): ReturnType<Bot['webhookCallback']>;
  setCommands(commands: readonly MaxBotCommand[]): Promise<void>;
  stop(): Promise<void>;
}>;

type MaxWebhookSubscription = Readonly<{ url?: unknown }>;

/**
 * Never remove an existing subscription implicitly during process startup.
 * Replacing another environment's endpoint is an operator-controlled action.
 */
export const assertNoConflictingWebhookSubscriptions = (
  subscriptions: readonly MaxWebhookSubscription[],
  targetUrl: string,
): void => {
  for (const subscription of subscriptions) {
    if (typeof subscription.url !== 'string' || subscription.url.length === 0) {
      throw new AppError('CONFIG_INVALID', 500, 'MAX вернул подписку Webhook без URL.');
    }
    if (subscription.url !== targetUrl) {
      throw new AppError('CONFIG_INVALID', 500, 'Обнаружена другая подписка MAX Webhook; удалите её вручную перед запуском.');
    }
  }
};

export const createMaxBot = (dependencies: MaxBotDependencies): MaxBotAdapter => {
  if (!dependencies.config.botToken) {
    throw new AppError('CONFIG_INVALID', 500, 'BOT_TOKEN не настроен.');
  }

  const logger = dependencies.logger.child({ component: 'max.transport' });
  const maxApiBaseUrl = dependencies.config.maxApiBaseUrl ?? 'https://platform-api2.max.ru';
  assertSafeMaxApiBaseUrl(maxApiBaseUrl);
  if (dependencies.config.transport === 'webhook') safeWebhookUrl(dependencies.config.webhookDomain, dependencies.config.webhookPath);
  const maxApiClient = new MaxApiClient({
    limiter: dependencies.maxApiLimiter ?? new MaxOutboundRateLimiter(),
    logger,
    metrics: dependencies.metrics,
  });
  const bot = new Bot(dependencies.config.botToken, {
    clientOptions: {
      baseUrl: normalizeMaxApiBaseUrl(maxApiBaseUrl),
      fetch: createMaxApiFetch(maxApiClient),
    },
  });
  let webhookServer: Server | undefined;
  let webhookUrl: string | undefined;
  let webhookSubscriptionOwnedByStart = false;

  const closeWebhookServer = async (): Promise<void> => {
    const server = webhookServer;
    webhookServer = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  };

  bot.catch((error, context) => {
    logger.error({
      updateType: context.updateType,
      error: errorToLogFields(error),
    }, 'MAX update failed');
  });

  bot.use(async (context) => {
    const startedAt = Date.now();
    const event = normalizeMaxUpdate(context, {
      isAdmin: dependencies.isAdmin,
      now: dependencies.now,
    });
    if (!event) {
      logger.debug({ updateType: context.updateType }, 'MAX update ignored');
      return;
    }

    logger.info({
      eventId: event.eventId,
      kind: event.kind,
      principalHash: principalHash(event.principal.userId),
      durationMs: Date.now() - startedAt,
    }, 'MAX update accepted');
    dependencies.metrics?.increment('max_update_accepted_total', { module: 'core' });
    const response = await dependencies.onEvent(event);
    if (response) {
      const render = dependencies.renderResponse ?? (async (targetContext: Context, targetResponse: PortalResponse) => {
        const attachments = renderPortalResponseAttachments(targetResponse);
        if (targetContext.updateType === 'message_callback') await targetContext.answerOnCallback({ message: { text: targetResponse.text, attachments } });
        else await targetContext.reply(targetResponse.text, { attachments });
      });
      await render(context, response);
    }
  });

  return {
    bot,
    async start(): Promise<void> {
      const allowedUpdates = [...DEFAULT_ALLOWED_UPDATES];
      if (dependencies.config.transport === 'webhook') {
        const targetWebhookUrl = safeWebhookUrl(dependencies.config.webhookDomain, dependencies.config.webhookPath);
        const options = {
          domain: dependencies.config.webhookDomain,
          port: dependencies.config.webhookPort,
          path: dependencies.config.webhookPath,
          ...(dependencies.config.webhookSecret ? { secret: dependencies.config.webhookSecret } : {}),
          allowedUpdates,
        };
        const callback = bot.webhookCallback(options);
        webhookServer = createServer(withWebhookGuard(callback, {
          path: dependencies.config.webhookPath,
          secret: dependencies.config.webhookSecret,
          logger,
          metrics: dependencies.metrics,
        }));
        webhookServer.requestTimeout = 30_000;
        webhookServer.headersTimeout = 10_000;
        webhookServer.keepAliveTimeout = 5_000;
        try {
          await bot.api.getMyInfo().then((info) => { bot.botInfo = info; });
          await new Promise<void>((resolve, reject) => {
            webhookServer?.once('error', reject);
            webhookServer?.listen(dependencies.config.webhookPort, () => {
              webhookServer?.off('error', reject);
              resolve();
            });
          });
          const subscriptions = await bot.api.getSubscriptions();
          assertNoConflictingWebhookSubscriptions(subscriptions, targetWebhookUrl);
          await bot.api.subscribe(targetWebhookUrl, dependencies.config.webhookSecret, allowedUpdates);
          webhookUrl = targetWebhookUrl;
          webhookSubscriptionOwnedByStart = true;
        } catch (error) {
          await closeWebhookServer().catch(() => undefined);
          if (webhookSubscriptionOwnedByStart && webhookUrl) await bot.api.unsubscribe(webhookUrl).catch(() => undefined);
          webhookSubscriptionOwnedByStart = false;
          webhookUrl = undefined;
          throw error;
        }
        return;
      }
      // Bot.start({ mode: 'polling' }) first clears every Webhook subscription.
      // Use the SDK's non-destructive polling primitive after preserving its
      // normal startup metadata lookup.
      bot.botInfo ??= await bot.api.getMyInfo();
      await bot.startPolling({ allowedUpdates, retry: true });
    },
    webhookCallback() {
      const callback = bot.webhookCallback({
        domain: dependencies.config.webhookDomain,
        port: dependencies.config.webhookPort,
        path: dependencies.config.webhookPath,
        ...(dependencies.config.webhookSecret ? { secret: dependencies.config.webhookSecret } : {}),
        allowedUpdates: [...DEFAULT_ALLOWED_UPDATES],
      });
      return withWebhookGuard(callback, {
        path: dependencies.config.webhookPath,
        secret: dependencies.config.webhookSecret,
        logger,
        metrics: dependencies.metrics,
      });
    },
    async setCommands(commands: readonly MaxBotCommand[]): Promise<void> {
      await bot.api.setMyCommands(commands.map((command) => ({ ...command })));
    },
    async stop(): Promise<void> {
      bot.stopPolling();
      await closeWebhookServer();
      // Keep the subscription across graceful restarts and rolling deploys.
      // Deletion is an explicit operator action, never an implicit shutdown side effect.
      webhookSubscriptionOwnedByStart = false;
      webhookUrl = undefined;
    },
  };
};
