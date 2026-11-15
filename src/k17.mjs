// K17 (declared funding outpoint rule), app/tx-library layer. The Funded contract cannot see who funded it:
// anyone can send coins to its address. A job therefore records the ONE outpoint that counts as its funding
// (txid:vout and value) when the employer funds it; F1 (accept) is only built for exactly that outpoint.
// Any other UTXO at the Funded address is "foreign": it never counts as job funding. F2 (cancel) can still
// return it to the employer (G1-01: no value floor), subject to network relay policy and a sponsor input.
import { SpendError } from './errors.mjs';

export const outpointKey = (u) => `${u.txid}:${u.vout}`;

export function declareFunding(job, outpoint) {
  if (job.declaredFunding) throw new SpendError('K17AlreadyDeclared', 'a job has exactly one declared funding outpoint');
  if (outpoint.satoshis !== job.params.F) throw new SpendError('K17Value', `declared funding must equal F (${job.params.F}), got ${outpoint.satoshis}`);
  return { ...job, declaredFunding: { txid: outpoint.txid, vout: outpoint.vout, satoshis: outpoint.satoshis } };
}

// utxos: everything currently at the Funded address.
export function classifyFunded(job, utxos) {
  const d = job.declaredFunding;
  const declared = d ? utxos.find((u) => u.txid === d.txid && u.vout === d.vout) : undefined;
  const foreign = utxos.filter((u) => !d || !(u.txid === d.txid && u.vout === d.vout));
  return { declared, foreign, declaredMissing: !!d && !declared, undeclared: !d };
}

export function assertF1Funding(job, utxo) {
  const d = job.declaredFunding;
  if (!d) throw new SpendError('K17NotDeclared', 'job has no declared funding outpoint');
  if (utxo.txid !== d.txid || utxo.vout !== d.vout) throw new SpendError('K17Mismatch', `F1 must spend the declared outpoint ${d.txid}:${d.vout}, not ${utxo.txid}:${utxo.vout}`);
  if (utxo.satoshis !== job.params.F || d.satoshis !== job.params.F) throw new SpendError('K17Value', 'funding value must equal F');
  return true;
}
