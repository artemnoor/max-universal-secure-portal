# Эксплуатационный runbook

Документ рассчитан на оператора staging/production. Все команды запускаются из корня репозитория; секреты передаются через secret manager или `.env`, но никогда не копируются в командную строку и журнал.

## Быстрый старт и DX

```sh
npm ci
cp .env.example .env
npm run maxapp -- doctor
npm run maxapp -- dev
```

В PowerShell вместо `cp` используйте `Copy-Item .env.example .env`. Для короткого локального gate используйте `npm run check`; полный release gate — `npm run check:full`.

Основные команды CLI:

- `maxapp dev` — HTTP/Mini App и MAX bot;
- `maxapp app`, `maxapp bot`, `maxapp migrate` — отдельные роли;
- `maxapp compose up|down|logs` — PostgreSQL/Redis Compose;
- `maxapp backup` и `maxapp restore --file <path> --confirm` — операции с БД.

## Диагностика

1. `GET /health/live` подтверждает, что процесс отвечает.
2. `GET /health/ready` проверяет PostgreSQL, Redis, миграции и module readiness checks.
3. `npm run maxapp -- doctor` проверяет конфигурационные инварианты выбранного окружения.
4. `npm run smoke:max` проверяет approved MAX staging smoke без печати токенов.
5. `GET /internal/metrics` доступен только при заданном `METRICS_TOKEN` и заголовке `Authorization: Bearer <token>`.
6. Для нескольких процессов снимайте metrics с HTTP и bot targets отдельно: `PortalMetrics` хранится в памяти конкретного процесса.

Dependency audit требует доступа к npm advisory endpoint. В закрытой сети можно выполнить `npm run audit:offline` или `NPM_AUDIT_OFFLINE=true npm run check:full`; это только локальная проверка кэша, перед release повторите online audit.

Пример безопасной проверки метрик:

```sh
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" https://portal.example.com/internal/metrics
```

## Минимальные алерты

Настройте алерты на:

- `/health/live` не отвечает более двух проверок подряд;
- `/health/ready` возвращает `503`;
- рост `auth_failures_total`, `rate_limits_total`, `webhook_failures_total` или `dependency_failures_total`;
- рост `max_api_429_total`, `max_update_failed_total` или `module_timeout_total`;
- отсутствие `max_update_accepted_total` при ожидаемом трафике;
- рост `portal_process_resident_memory_bytes` или частые перезапуски контейнера.

Критерии реакции: сначала сохранить `x-request-id` и временной диапазон, затем проверить логи соответствующего процесса, readiness dependencies и последние deployment/migration changes. Не передавайте в тикет `BOT_TOKEN`, `WEBHOOK_SECRET`, MAX init data, URL с credentials или PII.

## Ошибки запуска

- `MAX_TRANSPORT` в production/staging не `webhook` — остановить rollout и исправить конфигурацию.
- Нет `DATABASE_URL`/`REDIS_URL` — не пытаться переключать production на FileStore или in-memory store.
- Ошибка checksum миграции — остановить deployment, восстановить совместимый image и расследовать drift; не редактировать применённый SQL.
- Webhook отвечает `404` — проверить exact path, secret header на edge и отсутствие старой чужой подписки.
- `503` от MAX API — проверить `max_api_latency_ms`, `max_api_429_total`, DNS/TLS и лимиты, затем повторить только идемпотентные операции.
- Module callback denied — проверить allowlist и resource authorization, не отключать boundary в runtime.

## Миграции и backup

Перед rollout применяйте миграции отдельной ролью `maxapp migrate` или job `migrate`; app и bot ждут успешного завершения migration job.

Создать backup:

```sh
npm run db:backup -- --label pre-release
```

Восстановление намеренно требует checksum manifest и явный флаг:

```sh
npm run db:restore -- --file ./backups/portal-<timestamp>.dump --confirm
```

Перед restore остановите app/bot или направьте трафик на maintenance page. После restore выполните `maxapp migrate`, `/health/ready` и approved smoke. Backup-файлы и manifest не коммитятся (`backups/` в `.gitignore`).

## Логи и ротация

Приложение пишет структурированный JSON в stdout/stderr; `LOG_LEVEL` поддерживает `debug`, `info`, `warn`, `error`, `fatal`, `silent`. В Compose включена ротация Docker `json-file`: 10 MB на файл, 5 файлов на сервис. В Kubernetes/systemd аналогичные лимиты задаются на уровне runtime/log collector, а не в предметном модуле.

При расследовании фильтруйте по `component`, `requestId`, `eventId`, `moduleId` и `error.errorCode`. Logger редактирует credentials, auth payloads, телефоны, database/Redis URLs и secret-shaped fields.

## Graceful shutdown и rollback

SIGTERM/SIGINT закрывают host, HTTP listener, MAX adapter и storage в едином порядке; uncaught exception/unhandled rejection логируются как fatal и переводят процесс в failed exit. Не убивайте контейнер `SIGKILL`, пока не истёк termination grace period.

Откат допустим только на image, совместимый с текущей схемой. Destructive migration не использовать; при schema drift сначала восстановить совместимый backup по процедуре выше.
