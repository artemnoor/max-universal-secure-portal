# Plan: universal secure MAX scaffold

## Objective

Keep only reusable platform capabilities and remove all product-specific modules, buttons, routes, fixtures and domain terminology.

## Completed

- MAX Webhook/polling transport with non-destructive lifecycle.
- Fail-closed config and signed Mini App auth boundary.
- Generic portal contracts, module registry, bounded state and locks.
- Generic HTTP route extension with explicit access policy.
- PostgreSQL/Redis adapters, encrypted PII and dev-only FileStore.
- Neutral Mini App shell and security/browser checks.
- Generic docs and clean repository baseline.

## Verification

Run \`npm run check\`, \`npm run coverage:check\`, \`npm audit --offline --audit-level=high\`, and the approved staging smoke when credentials and origin are supplied.

## Next task

Add a separate product module without changing the core/platform trust boundaries.
