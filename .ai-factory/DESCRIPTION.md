# Project context

Универсальный защищённый каркас для MAX-бота, Mini App и API. В составе нет предметной логики: проект предоставляет transport, auth, application kernel, HTTP boundary, durable/ephemeral storage и пустые точки расширения для будущих модулей.

Стек: TypeScript/Node.js 22, MAX SDK, PostgreSQL, Redis, vanilla JavaScript Mini App, Docker Compose и GitHub Actions. Security-first требования: fail-closed configuration, signed MAX auth, explicit callback/HTTP policies, bounded input/state/output, encrypted PII и safe logging.

