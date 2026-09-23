# Хранение данных

Каркас по умолчанию хранит только то, что требуется подключённому модулю: профиль MAX, bounded conversation state, saved resource references, audit events и inbox idempotency markers.

Не храните секреты, полный auth payload, лишнюю PII или произвольные большие blobs. Для каждого модуля заранее определите retention, deletion flow и доступ администратора. В production используйте PostgreSQL/Redis с TLS и резервным копированием по политике оператора.

