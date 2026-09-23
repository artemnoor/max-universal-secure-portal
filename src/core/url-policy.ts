const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;

export const isSafeHostname = (value: string): boolean => {
  if (value.length < 1 || value.length > 253 || value.endsWith('.')) return false;
  const labels = value.split('.');
  return labels.every((label) => label.length > 0 && label.length <= 63 && HOST_LABEL.test(label));
};

/** Convert a configured HTTP(S) endpoint to the origin used by allowlists. */
export const configuredOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return HTTP_PROTOCOLS.has(url.protocol) ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

export const configuredOrigins = (values: readonly string[]): readonly string[] => [
  ...new Set(values.flatMap((value) => {
    const origin = configuredOrigin(value);
    return origin ? [origin] : [];
  })),
];
