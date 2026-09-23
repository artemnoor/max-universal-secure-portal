# MAX Webhook

Каркас поддерживает MAX Webhook и polling. Для Webhook задайте \`MAX_TRANSPORT=webhook\`, \`WEBHOOK_DOMAIN\`, \`WEBHOOK_PATH\` и URL-safe \`WEBHOOK_SECRET\`.

Runtime проверяет конфликтующие подписки и не удаляет подписки других окружений. Управление подписками выполняется оператором по [официальной документации MAX](https://dev.max.ru/docs-api/methods/POST/subscriptions). Для проверки используйте \`npm run smoke:max\` и не подставляйте реальные токены в CI.

