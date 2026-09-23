# Storage

Development/test используют FileStore только при пустых \`DATABASE_URL\` и \`REDIS_URL\`. Staging/production используют PostgreSQL и Redis; приложение не стартует с незащищённой или неполной конфигурацией.

Schema changes должны быть monotonic. Durable state хранится в PostgreSQL, ephemeral locks/rate limits — в Redis. PII-поля проходят encryption boundary до repository.

