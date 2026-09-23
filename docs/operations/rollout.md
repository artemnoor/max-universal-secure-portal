# Rollout

1. Соберите immutable image и выполните \`npm run check\`.
2. Выполните \`verify:config\` для целевого окружения.
3. Примените миграции отдельным migration job.
4. Запустите HTTP и MAX runtime после успешного migration job.
5. Проверьте \`/health/ready\`, metrics и approved smoke.
6. Откатывайте приложение только на совместимую с текущей схемой версию; destructive migration не использовать.

