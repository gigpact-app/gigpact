// Is the funding output confirmed? Electrum's listunspent reports height > 0 for a confirmed output and 0 or -1 for one that is
// still in the mempool. Returns true / false, or null when the server's answer does not say (callers then do not block).
export function confirmedFrom(list, txid, vout) {
  if (!Array.isArray(list)) return null;
  const e = list.find((x) => x && x.tx_hash === txid && x.tx_pos === vout);
  if (!e || typeof e.height !== 'number') return null;
  return e.height > 0;
}
