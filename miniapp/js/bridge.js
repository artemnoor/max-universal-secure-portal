export function bridgeResult(ok, value, reason = '') {
  return ok ? { ok: true, value } : { ok: false, value: null, reason };
}

export function readContact(bridge) {
  const contact = bridge?.requestContact ? bridge.requestContact() : null;
  return Promise.resolve(contact).then((value) => {
    if (!value || typeof value.vcf_info !== 'string' || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/iu.test(value.hash)) return bridgeResult(false, null, 'invalid_contact');
    if (value.max_info !== undefined && (!value.max_info || typeof value.max_info !== 'object' || Array.isArray(value.max_info) || !Number.isSafeInteger(value.max_info.user_id) || value.max_info.user_id <= 0 || Object.keys(value.max_info).some((key) => key !== 'user_id'))) return bridgeResult(false, null, 'invalid_contact');
    return bridgeResult(true, { vcf_info: value.vcf_info, hash: value.hash, ...(value.max_info ? { max_info: { user_id: value.max_info.user_id } } : {}) });
  }).catch(() => bridgeResult(false, null, 'cancelled'));
}

export function readLocation(bridge) {
  const value = bridge?.LocationManager?.getLocation ? bridge.LocationManager.getLocation() : null;
  return Promise.resolve(value).then((location) => {
    if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude)) || Math.abs(Number(location.latitude)) > 90 || Math.abs(Number(location.longitude)) > 180) return bridgeResult(false, null, 'invalid_location');
    return bridgeResult(true, { latitude: Number(location.latitude), longitude: Number(location.longitude) });
  }).catch(() => bridgeResult(false, null, 'cancelled'));
}
