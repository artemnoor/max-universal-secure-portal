# Module development contract

The portal starts with an empty product catalog. A future module is a `ModuleDefinition` with a versioned manifest and a setup function. Registration is completed before bot, web, migration, or gateway listeners start.

The manifest declares stable module ID and version, explicit dependencies, MAX event ownership, typed services, bounded namespaced events, capabilities, state quota, timeout, concurrency budget, and optional owned migration inputs.

Staging and production additionally require `manifest.securityReview` with a named owner, review date, threat-model reference, and declared data classes. The composition root fails closed when a module is missing this review. This does not replace a module's business authorization: every resource-bearing callback must still declare `authorize`, and every principal route must enforce ownership through scoped storage or an equivalent checked service.

The setup function registers only routes, callbacks, commands, services, readiness checks, and handlers. The registry rejects duplicate IDs, dependency cycles, missing providers, route/callback/command collisions, unsafe access policies, undeclared capabilities, and invalid migration metadata. The finalized catalog is the only surface consumed by hosts.

`ModuleContext` contains the verified principal, request/event identity, scoped state, principal-bound storage, audit writer, optional field-bound PII port, declared services, bounded event publication, capabilities, and a redacting logger. It does not expose MAX SDK objects, Node HTTP objects, SQL, Redis, `process.env`, credentials, or another module.

HTTP routes are forwarded through Node's existing authentication, origin, body, response, and security-header boundary. Route handlers return JSON data; they cannot set cookies, redirects, CORS/CSP, retry headers, or transport options. Resource-bearing callbacks require an authorization function and are checked against the verified principal.

For local development, run the Node hosts directly. For deployment with an edge, use:

```sh
docker compose -f docker-compose.yml -f docker-compose.edge.yml up --build
```

Nginx is an optional dumb proxy. TLS and secret injection are deployment responsibilities; Node remains authoritative for MAX Webhook secret validation, signed Mini App authentication, authorization, and rate limits. The same image has explicit `app`, `bot`, and `migrate` runtime roles so Compose/orchestrators can scale and restart them independently.
