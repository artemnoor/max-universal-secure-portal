# Shared contracts

`contracts/` is the only cross-runtime integration surface. The bot, HTTP host, Mini App and future workers may depend on these stable descriptions, but they do not import each other's implementation modules.

- `events.schema.json` describes the transport-neutral event envelope.
- `openapi.yaml` describes the generic HTTP/operational boundary.
- TypeScript/Zod implementations remain the runtime validators and must stay compatible with these documents.

Feature modules extend the portal through `ModuleDefinition`; they must not add undocumented global routes or mutate the shared envelope.
