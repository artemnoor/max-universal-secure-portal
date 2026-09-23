# MAX Universal Secure Portal

## Purpose

This repository is a secure, product-neutral foundation for a MAX bot, Mini App and HTTP API. Product behavior belongs in independently reviewed modules under `src/modules`; do not put business scenarios in core, transport, HTTP or infrastructure code.

## Boundaries

- `src/core`: config, errors, principals, URL policy and redacting logs.
- `src/portal`: transport-neutral contracts, module registry, application kernel and storage ports.
- `src/platform/max`: MAX SDK, signed auth, Webhook/polling, callbacks and limits.
- `src/http`: HTTP security boundary, health, metrics and safe static serving.
- `src/infrastructure`: PostgreSQL, Redis, runtime adapters, dev FileStore and PII crypto.
- `src/entrypoints` and `src/hosts`: composition and independent `app`, `bot` and `migrate` lifecycles.
- `miniapp`: generic browser shell; product UI is supplied by a module.
- `contracts`: stable JSON Schema/OpenAPI descriptions shared across runtime boundaries.

## Rules

- Validate untrusted data at every boundary and use stable public errors.
- Never log credentials, raw auth payloads, or PII.
- Every callback must be allowlisted and every resource callback must authorize ownership.
- Every new HTTP route must declare `public`, `principal` or `admin` access.
- Staging/production modules require a `manifest.securityReview` and module-specific security tests.
- Run `npm run check` for fast feedback and `npm run check:full` before release.
