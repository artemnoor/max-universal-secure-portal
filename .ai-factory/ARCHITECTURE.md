# Architecture rules

## Axioms

1. Core and platform do not import product modules.
2. Product behavior is added only through \`PortalModule\`, \`PortalHttpContent\` and explicit storage ports.
3. Every external input is parsed and bounded at the boundary.
4. Every callback and HTTP route has an explicit allowlist/access policy.
5. Durable state uses PostgreSQL; ephemeral state uses Redis; FileStore is development/test only.
6. Credentials, raw auth payloads and PII never enter logs or source control.

## Runtime boundaries

\`src/platform/max\` normalizes MAX updates and renders validated transport responses. \`src/portal\` owns module dispatch, locks, state versioning and response validation. \`src/http\` owns origin checks, MAX Init Data auth, body/response limits, health and safe static serving. \`src/infrastructure\` implements repositories and runtime composition. \`miniapp\` starts empty and is intentionally safe to replace.

## Extension contract

A future module should live under \`src/modules/<name>\`, register itself in the composition root, expose only validated DTOs, and define callback actions/routes in the module boundary. Do not add product terminology, fixtures or buttons to core files.

