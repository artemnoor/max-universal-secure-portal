export function setText(node, value) {
  if (node) node.textContent = String(value ?? '');
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[char]);
}

export function setSafeHref(node, value, allowedOrigins = []) {
  if (!node) return false;
  try {
    const url = new URL(value, globalThis.location?.origin || 'https://invalid.local');
    if (url.protocol !== 'https:' || !allowedOrigins.includes(url.origin)) return false;
    node.href = url.href;
    node.target = '_blank';
    node.rel = 'noreferrer';
    return true;
  } catch {
    return false;
  }
}

