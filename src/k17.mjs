// K17 (declared funding outpoint rule), app/tx-library layer. The Funded contract cannot see who funded it:
// anyone can send coins to its address. A job therefore records the ONE outpoint that counts as its funding
// (txid:vout and value) when the employer funds it; F1 (accept) is only built for exactly that outpoint.
// Any other UTXO at the Funded address is "foreign": it never counts as job funding. F2 (cancel) can still
// return it to the employer (G1-01: no value floor), subject to network relay policy and a sponsor input.
import { SpendError, checkOutpoint } from './errors.mjs';
import { assertChain, canonParams, cloneParams } from './chain.mjs';

// A job record is bound to ONE chain: its parameters and every contract address (I12).
export const newJob = (chain) => ({ params: cloneParams(chain.params), addresses: { ...chain.addresses } });

export const outpointKey = (u) => `${u.txid}:${u.vout}`;

const lc = (t) => String(t).toLowerCase();
export function declareFunding(job, outpoint) {
  checkOutpoint(outpoint, 'declared funding outpoint');
  if (job.declaredFunding) throw new SpendError('K17AlreadyDeclared', 'a job has exactly one declared funding outpoint');
  if (outpoint.satoshis !== job.params.F) throw new SpendError('K17Value', `declared funding must equal F (${job.params.F}), got ${outpoint.satoshis}`);
  return { ...job, declaredFunding: { txid: lc(outpoint.txid), vout: outpoint.vout, satoshis: outpoint.satoshis } };
}

// utxos: everything currently at the Funded address.
export function classifyFunded(job, utxos) {
  const d = job.declaredFunding;
  const declared = d ? utxos.find((u) => lc(u.txid) === d.txid && u.vout === d.vout) : undefined;
  const foreign = utxos.filter((u) => !d || !(lc(u.txid) === d.txid && u.vout === d.vout));
  return { declared, foreign, declaredMissing: !!d && !declared, undeclared: !d };
}

// The job must belong to exactly the chain being spent (same parameters, same five contract addresses),
// and that chain must itself be consistent with its parameters.
export function assertJobChain(job, chain) {
  if (!job?.params || !job?.addresses) throw new SpendError('K17ChainMismatch', 'job has no recorded parameters/addresses');
  chain = assertChain(chain); // fresh, verified rebuild; the claimed object is never trusted
  const keys = Object.keys(chain.addresses);
  const bad = keys.filter((k) => job.addresses[k] !== chain.addresses[k]);
  if (bad.length || Object.keys(job.addresses).length !== keys.length) throw new SpendError('K17ChainMismatch', `job was created for another chain (addresses differ: ${bad.join(',') || 'extra keys'})`);
  if (canonParams(job.params) !== canonParams(chain.params)) throw new SpendError('K17ParamMismatch', 'job parameters differ from the chain parameters');
  return true;
}

export function assertF1Funding(job, utxo, chain) {
  if (!chain) throw new SpendError('K17ChainMismatch', 'F1 needs the chain to verify the job against');
  assertJobChain(job, chain);
  const d = job.declaredFunding;
  if (!d) throw new SpendError('K17NotDeclared', 'job has no declared funding outpoint');
  if (lc(utxo.txid) !== d.txid || utxo.vout !== d.vout) throw new SpendError('K17Mismatch', `F1 must spend the declared outpoint ${d.txid}:${d.vout}, not ${utxo.txid}:${utxo.vout}`);
  if (utxo.satoshis !== job.params.F || d.satoshis !== job.params.F) throw new SpendError('K17Value', 'funding value must equal F');
  return true;
}
