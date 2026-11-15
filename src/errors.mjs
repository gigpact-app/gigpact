export class SpendError extends Error { constructor(code, m) { super(`${code}: ${m}`); this.name = 'SpendError'; this.code = code; } }

// A real-looking outpoint: 64 hex chars (any case) and a non-negative 32-bit index.
export function checkOutpoint(u, what = 'outpoint') {
  if (!(u && typeof u.txid === 'string' && /^[0-9a-fA-F]{64}$/.test(u.txid) && Number.isInteger(u.vout) && u.vout >= 0 && u.vout <= 0xffffffff)) throw new SpendError('BadOutpoint', `${what}: txid must be 64 hex chars and vout a non-negative 32-bit integer`);
}
