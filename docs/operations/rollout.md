# Rollout

1. Соберите immutable image и выполните `npm run check:full`.
2. Выполните `verify:config` для целевого окружения.
3. Примените миграции отдельным migration job.
4. Запустите HTTP и MAX runtime после успешного migration job.
5. При использовании edge-профиля запустите `docker compose -f docker-compose.yml -f docker-compose.edge.yml up -d`; наружу публикуется только gateway.
6. Проверьте `/health/ready`, `/internal/metrics` с bearer token и approved smoke.
7. Откатывайте приложение только на совместимую с текущей схемой версию; destructive migration не использовать.
