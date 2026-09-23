# Feature modules

This directory is intentionally empty in the universal scaffold. A feature module is registered through `createPortalComposition` as a `ModuleDefinition` and must keep its public surface inside the declared manifest.

Modules may use only `ModuleContext`, `ModuleStorage`, the audit/PII ports granted by composition, declared services, bounded events, and registered routes/callbacks/commands. MAX SDK, Node HTTP, PostgreSQL, Redis, environment variables, credentials, and other modules stay outside this boundary.
