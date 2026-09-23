export function toSafeExternalUrl(value, allowedOrigins = [], baseOrigin = globalThis.location?.origin || 'https://invalid.local') {
  try {
    const url = new URL(value, baseOrigin);
    if (url.protocol !== 'https:') return null;
    if (!allowedOrigins.some((origin) => url.origin === origin)) return null;
    return url;
  } catch {
    return null;
  }
}
