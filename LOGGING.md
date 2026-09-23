# Logging and observability contract

Runtime output is structured JSON. Use `component`, `requestId`, `eventId`, `moduleId`, `durationMs` and `error.errorCode` to correlate a failure. The logger redacts credentials, auth payloads, PII and URLs containing secrets.

Use `GET /internal/metrics` with `Authorization: Bearer <METRICS_TOKEN>` for Prometheus exposition. Scrape the HTTP and bot roles separately. See [docs/operations/observability.md](docs/operations/observability.md) for metrics, alert thresholds and response steps.
