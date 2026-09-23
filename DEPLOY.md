# Deployment contract

1. Build an immutable image.
2. Run `npm run check:full` with online dependency audit.
3. Run `verify:config` for the target environment.
4. Apply migrations as the `migrate` role.
5. Start `app` and `bot` only after the migration job succeeds.
6. Put the optional Nginx edge in front when TLS termination/routing is needed.
7. Verify readiness, protected metrics and approved MAX smoke checks.

The complete operator procedure, backup/restore and rollback rules are in [docs/operations/rollout.md](docs/operations/rollout.md) and [docs/operations/runbook.md](docs/operations/runbook.md).
