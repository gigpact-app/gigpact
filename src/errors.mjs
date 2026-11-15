export class SpendError extends Error { constructor(code, m) { super(`${code}: ${m}`); this.name = 'SpendError'; this.code = code; } }

// A real-looking outpoint: 64 hex chars (any case) and a non-negative 32-bit index.
export function checkOutpoint(u, what = 'outpoint') {
  if (!(u && typeof u.txid === 'string' && /^[0-9a-fA-F]{64}$/.test(u.txid) && Number.isInteger(u.vout) && u.vout >= 0 && u.vout <= 0xffffffff)) throw new SpendError('BadOutpoint', `${what}: txid must be 64 hex chars and vout a non-negative 32-bit integer`);
}

// Strict byte conversion: hex strings must be even-length valid hex, anything else must already be a Uint8Array.
// (libauth's hexToBin silently turns malformed hex into other bytes, which could silently redirect funds.)
export function strictBytes(b) {
  if (b instanceof Uint8Array) return b;
  if (typeof b === 'string' && /^(?:[0-9a-fA-F]{2})*$/.test(b)) {
    const out = new Uint8Array(b.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(b.slice(2 * i, 2 * i + 2), 16);
    return out;
  }
  throw new SpendError('BadBytes', 'expected a Uint8Array or an even-length hex string');
}
