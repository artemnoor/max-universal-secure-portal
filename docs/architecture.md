# Архитектура

Каркас разделён на независимые transport, application, HTTP, host и infrastructure boundaries.

- `src/core` содержит конфигурацию, ошибки, principal, URL policy и redacting logger; он не знает о MAX SDK и предметной области.
- `src/portal` содержит transport-neutral contracts, versioned module registry, dependency graph, kernel, scoped ports and module policies.
- `src/platform/max` нормализует внешние MAX updates, проверяет Webhook boundary и строит безопасный transport response.
- `src/http` owns origin checks, signed MAX auth, body/response limits, access policy and static serving.
- `src/infrastructure` implements PostgreSQL, Redis, PII encryption, migration verification and development-only storage.
- `src/entrypoints/composition.ts` is the only composition root; `src/hosts` own bot, web and migration lifecycle.
- `src/modules` is empty by default and reserved for independent feature modules.
- `miniapp` is intentionally an empty UI shell.

The catalog is finalized before listeners start. It aggregates module event handlers, HTTP routes, callback definitions, commands, services, readiness checks and explicit migration inputs. The default catalog contains no product behavior.

See [module development](architecture/modules.md) for contracts and [security threat model](security/threat-model.md) for the trust boundary.
