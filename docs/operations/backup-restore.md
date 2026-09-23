# Backup и restore PostgreSQL

## Политика

Backup выполняется через `pg_dump` в custom format и сопровождается JSON manifest с размером и SHA-256. Секреты не попадают в аргументы процесса или manifest: пароль передаётся дочернему процессу через `PGPASSWORD`.

```sh
npm run db:backup -- --label daily
```

Путь по умолчанию — `./backups`; его можно заменить `BACKUP_DIR` или `--output-dir`. Укажите `PG_DUMP_BIN`, если `pg_dump` не находится в `PATH`.

## Restore

Restore не выполняется без `--confirm` и валидного соседнего manifest. По умолчанию используется `--single-transaction` без `--clean`, поэтому старые объекты не удаляются автоматически.

```sh
npm run db:restore -- --file ./backups/daily-<timestamp>.dump --confirm
```

Порядок восстановления:

1. остановить или изолировать app/bot;
2. проверить backup и соответствие image/schema;
3. выполнить restore;
4. выполнить `maxapp migrate`;
5. проверить `/health/ready`, метрики и approved smoke;
6. вернуть трафик и наблюдать error rate.

Для `pg_restore` вне `PATH` используйте `PG_RESTORE_BIN`. Операции restore в production должны выполняться только оператором с отдельным change approval.
