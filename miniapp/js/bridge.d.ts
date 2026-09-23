export type BridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; value: null; reason: string };

export function readContact(bridge: unknown): Promise<BridgeResult<{ vcf_info: string; hash: string; max_info?: { user_id: number } }>>;
export function readLocation(bridge: unknown): Promise<BridgeResult<{ latitude: number; longitude: number }>>;
