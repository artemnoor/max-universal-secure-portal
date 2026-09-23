# Architecture contract

The repository is a product-neutral MAX portal with independent `app`, `bot` and `migrate` runtime roles. `src/entrypoints/composition.ts` is the only composition root; hosts consume the finalized catalog and never register product behavior themselves.

The detailed boundaries, module admission gate and optional edge topology live in [docs/architecture.md](docs/architecture.md) and [docs/architecture/modules.md](docs/architecture/modules.md). The machine-readable integration surface is under [`contracts/`](contracts/README.md) and is checked by `npm run check:contracts`.

Scaling rule: run the HTTP/Mini App host and MAX transport host as separate replicas. The shared PostgreSQL/Redis adapters provide durable state, idempotency and distributed locks; no in-memory state is a production source of truth.
