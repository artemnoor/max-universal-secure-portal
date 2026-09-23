import { Bot } from '@maxhub/max-bot-api';

import { AppError, ERROR_CODES } from '../../core/errors.js';

export type PollingRunnerOptions = Readonly<{
  nodeEnv: 'development' | 'test' | 'staging' | 'production';
  allowedUpdates: readonly string[];
}>;

export const startDevelopmentPolling = async (
  bot: Bot,
  options: PollingRunnerOptions,
): Promise<() => void> => {
  if (options.nodeEnv !== 'development' && options.nodeEnv !== 'test') {
    throw new AppError(ERROR_CODES.CONFIG_INVALID, 500, 'Polling разрешён только в development/test.');
  }

  let stopped = false;
  bot.botInfo ??= await bot.api.getMyInfo();
  void bot.startPolling({
    allowedUpdates: [...options.allowedUpdates] as never[],
    retry: true,
  });
  return () => {
    if (stopped) return;
    stopped = true;
    bot.stopPolling();
  };
};
