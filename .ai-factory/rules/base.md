# Базовые правила проекта

> Автоматически выведенные conventions из текущего TypeScript-кода; уточняются при изменении архитектуры.

## Naming Conventions

- Файлы и директории: kebab-case, кроме обязательных ecosystem-файлов.
- Переменные и функции: camelCase; типы, классы и интерфейсы: PascalCase.
- Публичные contracts и ошибки должны иметь явные типы и стабильные имена.

## Module Structure

- `src/core` — config, errors, principal и logging без transport/domain imports.
- `src/portal` — neutral contracts, application orchestration, state и ports.
- `src/platform/max` — единственная прямая граница MAX SDK.
- `src/http` — HTTP security boundary; domain content приходит через `PortalHttpContent`.
- `src/modules/*` — domain adapters; `src/infrastructure` — implementations of ports.
- `src/entrypoints` и `src/app-server.ts` — composition roots и lifecycle.

## Error Handling

- Использовать `AppError`/stable error codes и client-safe messages на внешних boundaries.
- Unknown errors логировать через redacting structured logger и не возвращать их raw message клиенту.
- Проверять внешний input через Zod или специализированный typed validator до domain/storage calls.

## Control Flow

- Предпочитать guard clauses, ранние `return`/`continue` и небольшие именованные helpers.
- Не смешивать parsing, authorization, domain decisions и persistence в одной boundary-функции.
- Fail closed для production security/configuration invariants.

## Logging

- Использовать structured logger, request IDs и `principalHash`; raw user id, initData, PII,
  tokens, connection strings и полные пользовательские тексты не логировать.
- `console` в production source не использовать; bootstrap errors проходят через безопасный logger.

## Testing

- Unit tests используют `node:test`/`tsx`; security boundaries получают positive и negative cases.
- Integration tests с PostgreSQL/Redis включаются explicit environment flag.
- Новые trust-boundary изменения требуют regression test и обновления owner-документации.
