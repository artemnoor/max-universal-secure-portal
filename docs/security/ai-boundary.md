# Граница optional AI

AI не включён и не является частью базовой композиции. Если модуль добавляет AI, он должен:

- отправлять только минимально необходимый redacted input;
- использовать allowlisted HTTPS endpoint, timeout и bounded response;
- валидировать результат строгой схемой;
- иметь deterministic fallback и отдельный release gate;
- не принимать от модели роли, права, URL, SQL или готовые authorization decisions.

