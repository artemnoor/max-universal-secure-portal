# Архитектура

Каркас разделён на transport, application, HTTP и infrastructure boundaries.

- \`src/core\` не знает о MAX SDK и предметной области.
- \`src/platform/max\` нормализует внешние события и строит безопасный transport response.
- \`src/portal\` содержит contracts, module registry, application kernel и storage ports.
- \`src/http\` owns origin checks, signed MAX auth, body/response limits, access policy and static serving.
- \`src/infrastructure\` implements PostgreSQL, Redis and development-only storage.
- \`miniapp\` is intentionally an empty UI shell.

Предметный модуль регистрируется в \`createPortalApplication\`, а HTTP-модуль реализует \`PortalHttpContent.routes()\` с явным \`public\`/ \`principal\`/ \`admin\` access policy. Core не содержит готовых кнопок, маршрутов или пользовательского сценария.

