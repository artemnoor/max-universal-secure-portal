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
- module registration is a separate trust boundary: dependency graph, capability allowlist, route policy, callback authorization, state quotas, timeouts, concurrency and output handling are enforced by the kernel;
- module storage is principal/module scoped; PII is field/context-bound and the optional Nginx edge never replaces Node authorization.
- staging/production module registration requires a recorded `securityReview` owner, date, threat-model reference and data-class declaration; missing review fails closed before listeners start;
- release gates include module boundary, security coverage and dependency-audit checks, so a module cannot enter a protected environment without the repository's contract checks passing.

Остаточный риск: предметный модуль всё ещё может ошибочно ослабить бизнес-авторизацию или обработать чувствительные данные не по назначению. Поэтому `securityReview` — только fail-closed admission gate, а не доказательство корректности: каждый модуль должен проходить отдельный review, security tests и проверку ownership на каждом principal/resource route.
