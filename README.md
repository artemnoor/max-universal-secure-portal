# MAX Universal Secure Portal

Универсальный каркас для MAX-бота, Mini App и API. В репозитории нет готового бизнес-сценария: подключите собственные модули, маршруты и экран после клонирования.

## Что уже есть

- отдельные MAX bot и HTTP/Mini App runtime;
- Webhook и polling с безопасным lifecycle;
- проверка подписанных MAX Init Data и запрет auth в query string;
- строгая валидация событий, callback payloads и ответов модулей;
- PostgreSQL repositories, Redis locks/rate limits и dev-only FileStore;
- encrypted PII fields, audit log, idempotent update inbox и bounded conversation state;
- hardened HTTP headers, CORS allowlist, body/response limits и safe static serving;
- health/readiness endpoints, Docker Compose, migrations, smoke/browser/security checks.

## Быстрый старт

```powershell
npm ci
Copy-Item .env.example .env
npm run check
npm run app
```

Для локальной разработки без PostgreSQL и Redis оставьте `DATABASE_URL` и `REDIS_URL` пустыми. FileStore разрешён только в `development`/`test`.

## Подключение своего модуля

1. Создайте модуль в `src/modules/<module-name>` по [контракту модулей](docs/architecture/modules.md).
2. Реализуйте `ModuleDefinition` и передайте его в `createPortalComposition` в своём deployment composition.
3. Для HTTP регистрируйте route с явной `public`/`principal`/`admin` policy и capability.
4. Добавляйте callback actions только через allowlist; resource-bearing actions обязаны иметь authorization policy.
5. Не переносите секреты, PII или продуктовые fixture-данные в код и Git.

## Production

В `staging`/`production` обязательны Webhook, PostgreSQL, Redis, TLS для внешних endpoints, `PII_ENCRYPTION_KEY`, secure origins и release gates. Перед запуском:

```powershell
npm run verify:config -- --mode production
npm run db:migrate
npm run check
```

`bot` не удаляет чужую MAX Webhook-подписку и не снимает свою автоматически при graceful shutdown. Оператор управляет подписками отдельно по [официальной документации MAX](https://dev.max.ru/docs-api/methods/POST/subscriptions).

## Основные файлы

- `src/entrypoints/bot.ts` — composition root для MAX.
- `src/entrypoints/composition.ts` — единая сборка runtime, kernel и module catalog.
- `src/hosts/` — отдельные lifecycle hosts для bot, web и migration.
- `src/app-server.ts` — HTTP lifecycle.
- `src/portal/contracts.ts` — transport-neutral contracts.
- `src/portal/application.ts` — module kernel и state boundary.
- `src/http/app.ts` — security boundary для API и static files.
- `src/infrastructure/postgres/repositories.ts` — durable storage adapters.
- `docs/architecture.md` — зависимости и границы.
- `docs/architecture/modules.md` — контракты и правила расширения.
- `docs/security/threat-model.md` — угрозы и остаточные риски.
- `docs/operations/runbook.md` — эксплуатационные проверки.
