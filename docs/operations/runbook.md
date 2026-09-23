# Runbook

## Проверка

- \`/health/live\` — процесс отвечает.
- \`/health/ready\` — зависимости доступны.
- \`npm run verify:config -- --mode production\` — конфигурация fail-closed.
- \`npm run db:migrate\` — миграции применены.
- \`npm run smoke:max\` — approved staging smoke.

При проблеме сначала проверьте конфигурацию, migration gate, PostgreSQL, Redis, MAX Webhook subscription и origin allowlist. Не печатайте токены и auth payloads в журнал.

