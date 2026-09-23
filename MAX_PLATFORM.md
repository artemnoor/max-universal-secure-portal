# MAX platform boundary

MAX updates are normalized into the transport-neutral event envelope in `contracts/events.schema.json`. Signed Mini App authentication is accepted only from `X-Max-Init-Data`; query-string auth is rejected. Webhook requests require the configured path and secret, while polling startup never deletes an operator-owned subscription.

The supported transport and subscription lifecycle are documented in [docs/max/webhook.md](docs/max/webhook.md). Platform adapter code belongs in `src/platform/max`; feature modules must use the declared portal contracts instead of importing the MAX SDK.
