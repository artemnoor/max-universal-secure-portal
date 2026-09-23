const segmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export function safeDecode(value) { try { const decoded = decodeURIComponent(value); return decoded.length <= 128 && segmentPattern.test(decoded) ? decoded : ''; } catch { return ''; } }
export function parseRouteHash(hash) {
  const raw = typeof hash === 'string' ? hash.slice(0, 512).replace(/^#\/?/, '') : '';
  const parts = raw.split('/').filter(Boolean).map(safeDecode).filter(Boolean);
  return { view: parts[0] || '', parts: parts.slice(1) };
}
