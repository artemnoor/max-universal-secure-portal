export function getMaxBridge() {
  return typeof window !== 'undefined' ? window.WebApp || window.MaxBridge || null : null;
}

export function getInitData(bridge = getMaxBridge()) {
  return typeof bridge?.initData === 'string' ? bridge.initData : '';
}

export function buildAuthHeaders(bridge = getMaxBridge()) {
  const raw = getInitData(bridge);
  return raw ? { 'X-Max-Init-Data': raw } : {};
}
