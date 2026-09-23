# AGENTS.md

## Назначение

Универсальный защищённый каркас портала для MAX. Репозиторий не содержит предметной логики, готовых пользовательских сценариев или доменных кнопок: они добавляются отдельными модулями.

## Стек

- TypeScript / Node.js 22.
- MAX Webhook или polling через `@maxhub/max-bot-api`.
- PostgreSQL для durable state, Redis для ephemeral state и distributed locks.
- Vanilla JavaScript Mini App и MAX Bridge.
- `node:test`, TypeScript, Playwright, Docker Compose, GitHub Actions.

## Границы

```text
src/core              config, errors, principal, logging, URL policy
src/portal            contracts, application kernel, module registry, storage ports
src/platform/max      MAX SDK, signed auth, Webhook/polling, callbacks, limits
src/http              HTTP security boundary, health, safe static serving, route extension
src/infrastructure    PostgreSQL, Redis, runtime, dev FileStore, PII crypto
src/entrypoints        bot and migration entrypoints
miniapp               minimal browser shell and shared client primitives
db/migrations          monotonic SQL migrations
tests                  unit, integration, smoke and browser-policy tests
docs                   architecture, security and operations docs
```

## Точки расширения

- `PortalModule` — предметный сценарий MAX.
- `PortalHttpContent` — предметные HTTP routes с явным access policy.
- `PortalAction` и callback definitions — только для действий, зарегистрированных модулем.
- `StoragePort` — durable state, saved resources and audit records.
- `miniapp/index.html` и `miniapp/app.js` — UI shell for the selected product.

## Правила

- Не помещать доменные сценарии в `src/core`, `src/platform`, `src/http` или инфраструктуру.
- Проверять входные данные на каждой границе; использовать stable errors; не логировать credentials, auth payloads или PII.
- Любой новый callback должен иметь allowlist definition и authorization check.
- Любой новый HTTP route должен иметь явный `public`, `principal` или `admin` access policy.
- Не добавлять реальные секреты, пользовательские данные или конкретный продуктовый контент в репозиторий.
- Перед gate запускать `npm run check` и security coverage.
