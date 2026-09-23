import { pathToFileURL } from 'node:url';

import { startBot } from './entrypoints/bot.js';

export { createMaxBot, DEFAULT_ALLOWED_UPDATES } from './platform/max/create-max-bot.js';
export { startBot } from './entrypoints/bot.js';

const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMainModule) {
  void startBot().catch(() => {
    process.exitCode = 1;
  });
}
