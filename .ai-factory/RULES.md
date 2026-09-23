# Правила проекта

> Короткие axioms, автоматически загружаемые `$aif-implement`.

## Rules

- Новые transport и domain features обязаны использовать typed contracts, ports, schemas и ownership policy.
- MAX SDK должен импортироваться только внутри `src/platform/max`.
- Production configuration должна fail closed при polling, unverified auth, wildcard CORS, plaintext Redis или отсутствии durable storage/PII key.
- Пользовательская authority определяется только verified principal, а не body/query-полями.
- Raw `initData`, credentials, PII и полные пользовательские тексты нельзя сохранять или логировать.
- Каждая database migration должна быть monotonic и проходить checksum/drift validation.
- AI может предлагать intent, но не может выполнять tools, назначать role или менять durable state.
- Изменение security boundary требует negative test, coverage evidence и обновления threat/operations docs.
