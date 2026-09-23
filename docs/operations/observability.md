# Observability

## Logs

Все runtime-компоненты используют structured JSON logger. Основные поля: `time`, `level`, `component`, `requestId`, `eventId`, `moduleId`, `durationMs`, `error.errorCode` и `msg`. Значения credentials, auth payloads, PII и URL с паролями редактируются до записи.

`LOG_LEVEL=info` подходит для production; `debug` включайте временно и только на ограниченном интервале. Сборщик должен сохранять stdout/stderr отдельно для `app`, `bot`, `migrate` и `gateway`, добавляя environment, image digest и container name как внешние labels.

## Metrics

Каждый HTTP/bot process имеет собственный in-memory `PortalMetrics`. Экспорт включается переменной `METRICS_TOKEN` и доступен на:

```text
GET /internal/metrics
Authorization: Bearer <METRICS_TOKEN>
```

Без токена endpoint возвращает `404`, чтобы не раскрывать наличие внутреннего маршрута. Метрики не содержат user id, raw callback, auth payload или URL.

Ключевые группы:

- HTTP/auth: `http_requests_total`, `auth_failures_total`, `rate_limits_total`;
- MAX: `max_update_accepted_total`, `max_update_duplicate_total`, `max_update_failed_total`, `max_api_requests_total`, `max_api_429_total`, `max_api_latency_ms`;
- dependencies: `dependency_failures_total`, `readiness_failures_total`;
- module safety: `module_capability_denied_total`, `module_callback_denied_total`, `module_timeout_total`, `module_state_quota_rejected_total`;
- process: `portal_process_start_time_seconds`, `portal_process_uptime_seconds`, `portal_process_resident_memory_bytes`, `graceful_shutdown_total`, `uncaught_exception_total`.

Prometheus должен скрапить app и bot отдельно. Для production задайте recording rules по 5m rate и alert rules на readiness, error ratio, MAX 429/5xx, webhook failures, module timeouts и restart loops.

## Alert response

Каждый alert должен содержать environment, target, first-seen time и ссылку на runbook. Оператор сначала проверяет `/health/live`, затем `/health/ready`, логи по `requestId`/`eventId` и последние migration/deployment changes. После устранения причины повторно запускаются `npm run smoke:max` и соответствующий browser/integration smoke.
