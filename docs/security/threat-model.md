# Модель угроз

## Границы доверия

MAX updates, Mini App requests, callback payloads, external module routes, PostgreSQL, Redis и browser являются недоверенными или частично доверенными входами.

## Контрмеры

- подписанная MAX \`initData\` проверяется на HTTP boundary; авторизация в query string отвергается;
- Webhook защищён secret/path guard, lifecycle не снимает чужую подписку;
- callback actions работают только по allowlist модуля и могут проверять principal ownership;
- state, item ids, body и response имеют жёсткие лимиты;
- PII шифруется до записи в PostgreSQL; credentials и payloads не попадают в логи;
- Redis используется для TTL, locks и rate limits; PostgreSQL update inbox обеспечивает idempotency;
- static serving блокирует traversal, source maps и небезопасный origin;
- production config требует Webhook, durable storage, TLS и release gates.

Остаточный риск: предметный модуль может ошибочно ослабить свою бизнес-авторизацию. Поэтому каждый модуль должен проходить отдельный review и security tests.

