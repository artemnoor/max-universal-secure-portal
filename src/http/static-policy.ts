export const staticContentSecurityPolicy = (origins: readonly string[]): string => {
  const connect = ["'self'", ...origins.filter((origin) => /^https?:\/\//u.test(origin))].join(' ');
  return [
    "default-src 'self'",
    "script-src 'self' https://st.max.ru",
    "style-src 'self' https://fonts.googleapis.com",
    `connect-src ${connect}`,
    "img-src 'self' data:",
    "font-src 'self' https://fonts.gstatic.com",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self' https://max.ru https://web.max.ru",
    "form-action 'self'",
  ].join('; ');
};
