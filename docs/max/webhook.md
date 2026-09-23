# MAX Webhook

Каркас поддерживает MAX Webhook и polling. Для Webhook задайте `MAX_TRANSPORT=webhook`, `WEBHOOK_DOMAIN`, `WEBHOOK_PATH` и URL-safe `WEBHOOK_SECRET`.

В edge-профиле Nginx пересылает точный `WEBHOOK_PATH` на внутренний bot host. Заголовок `x-max-bot-api-secret` проходит до Node без подмены; проверка секрета и тела остаётся в `src/platform/max/webhook.ts`. Nginx не выполняет авторизацию MAX.

Runtime проверяет конфликтующие подписки и не удаляет подписки других окружений. Управление подписками выполняется оператором по [официальной документации MAX](https://dev.max.ru/docs-api/methods/POST/subscriptions). Для проверки используйте `npm run smoke:max` и не подставляйте реальные токены в CI.
