// GigPact transaction library, part 2: spend plans for the 16 paths.
// A "plan" is plain data (inputs, outputs, locktime, sequences) that can be reviewed and tested
// without signing; toBuilder() turns it into a CashScript TransactionBuilder for dry-run or local signing.
import { TransactionBuilder, SighashType, randomUtxo } from 'cashscript';
import { binToHex, hexToBin, decodeTransactionBch, encodeTransactionBch } from '@bitauth/libauth';
import { assertChain } from './chain.mjs';
import { SpendError } from './errors.mjs';
import { assertF1Funding } from './k17.mjs';

export const SEQ_NONFINAL = 0xfffffffe;      // sponsor inputs and non-CSV contract inputs (G6: no relative lock, CLTV needs non-final)
export const SIGHASH_61 = SighashType.SIGHASH_ALL | SighashType.SIGHASH_UTXOS; // on wire 0x61
export const MIN_OUTPUT = 546n;               // SDK/network floor for the sponsor change output (G7 measures real policy)
export const MAX_FEE_RATE = 2;                // sat/byte, doc 1.3 suggestion (library policy, not a contract rule)
const FEE_SLACK = 2n;                         // sat of rounding / DER-length jitter allowed on top of size*MAX_FEE_RATE
export const BIP68_DISABLE = 0x80000000, BIP68_TYPE = 0x400000, BIP68_VALUE_MASK = 0xffff;

// nSequence for a block-based BIP68 relative lock of n blocks: only the low 16 bits, disable flag and time-type flag clear.
export function csvSequence(n) {
  need(typeof n === 'bigint' && n >= 1n && n <= 0xffffn, 'BadCsvSequence', `relative lock must be 1..65535 blocks, got ${n}`);
  const seq = Number(n);
  need((seq & BIP68_DISABLE) === 0 && (seq & BIP68_TYPE) === 0 && (seq & ~BIP68_VALUE_MASK) === 0 && seq === Number(n), 'BadCsvSequence', 'sequence must be block-based with no flag bits');
  return seq;
}

const bytesOf = (b) => (typeof b === 'string' ? hexToBin(b) : b);
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
export { SpendError };
const need = (c, code, m) => { if (!c) throw new SpendError(code, m); };

// id -> contract key, function, signer, time rule, outputs given F
export const PATHS = {
  F1: { c: 'funded', fn: 'accept', signer: 'W', outs: (L, F) => [[L.accepted, F]] },
  F2: { c: 'funded', fn: 'cancel', signer: 'V', outs: (L, F) => [[L.V, F]] },
  A1: { c: 'accepted', fn: 'pay', signer: 'V', outs: (L, F) => [[L.W, F]] },
  A2: { c: 'accepted', fn: 'waive', signer: 'W', outs: (L, F) => [[L.V, F]] },
  A3: { c: 'accepted', fn: 'claim', signer: 'W', outs: (L, F) => [[L.requested, F]], cltv: 'tEnd' },
  A4: { c: 'accepted', fn: 'openDispute', signer: 'V', outs: (L, F) => [[L.d50, F]], cltv: 'tA4' },
  C1: { c: 'requested', fn: 'complete', signer: null, outs: (L, F) => [[L.W, F]], csv: 'dv' },
  C2: { c: 'requested', fn: 'objectClaim', signer: 'V', outs: (L, F) => [[L.d100, F]] },
  C3: { c: 'requested', fn: 'payOut', signer: 'V', outs: (L, F) => [[L.W, F]] },
  C4: { c: 'requested', fn: 'waive', signer: 'W', outs: (L, F) => [[L.V, F]] },
  D1: { c: 'd100', fn: 'decideWorker', signer: 'A', outs: (L, F, p) => [[L.W, F - p.fA], [L.A, p.fA]] },
  D2: { c: 'd100', fn: 'decideEmployer', signer: 'A', outs: (L, F, p) => [[L.V, F - p.fA], [L.A, p.fA]] },
  D3: { c: 'd100', fn: 'decideSplit', signer: 'A', outs: (L, F, p) => { const w = (F - p.fA) / 2n; return [[L.W, w], [L.V, F - p.fA - w], [L.A, p.fA]]; } },
  D4: { c: 'd100|d50', fn: 'fallback', signer: null, csv: 'l', outs: (L, F, p, phi) => (phi === 100 ? [[L.W, F]] : [[L.W, F / 2n], [L.V, F - F / 2n]]) },
  D5: { c: 'd100|d50', fn: 'payOut', signer: 'V', outs: (L, F) => [[L.W, F]] },
  D6: { c: 'd100|d50', fn: 'waive', signer: 'W', outs: (L, F) => [[L.V, F]] },
};
export const PATH_IDS = Object.keys(PATHS);

// ctx: { phi?:100|50 (dispute instance), tipHeight?, confirmations?, dryRun? }
// utxo: { txid, vout, satoshis }   sponsors: [{ txid, vout, satoshis, lockingBytecode, token? }]
export function planSpend({ chain, path, utxo, sponsors, feeRate = 1, ctx = {}, job }) {
  const P = PATHS[path]; need(P, 'UnknownPath', String(path));
  const p = chain.params, L = chain.locks;
  const phi = ctx.phi ?? 100;
  need(phi === 100 || phi === 50, 'BadPhi', 'phi must be 100 or 50');
  const ck = P.c.includes('|') ? (phi === 100 ? 'd100' : 'd50') : P.c;
  const contract = chain.contracts[ck];
  need(utxo && typeof utxo.satoshis === 'bigint', 'BadUtxo', 'contract UTXO required');
  assertChain(chain); // I12: the chain's addresses are exactly what its parameters produce
  // the supplied UTXO must really sit at the expected contract lock, and carry no CashTokens/NFTs (BCH-only boundary)
  need(utxo.lockingBytecode !== undefined && utxo.lockingBytecode !== null, 'UtxoLockMissing', 'contract UTXO must include its actual lockingBytecode');
  need(sameBytes(bytesOf(utxo.lockingBytecode), L[ck]), 'UtxoLockMismatch', `UTXO is not locked by the ${ck} contract of this chain`);
  need(!utxo.token, 'ContractUtxoToken', 'contract UTXO must carry no token or NFT (BCH-only)');
  need(Array.isArray(sponsors) && sponsors.length >= 1 && sponsors.length <= 2, 'SponsorCount', 'R-0 needs 1 or 2 sponsor inputs (2..3 inputs in total)');
  for (const s of sponsors) need(!s.token, 'SponsorToken', 'sponsor inputs must carry no token or NFT (tokenCategory == 0x)');
  need(feeRate > 0 && feeRate <= MAX_FEE_RATE, 'FeeRate', `fee rate must be in (0, ${MAX_FEE_RATE}] sat/byte`);
  if (path === 'F1') { need(job, 'K17NotDeclared', 'F1 needs the job record (K17)'); assertF1Funding(job, utxo, chain); }
  const F = utxo.satoshis;
  const outs = P.outs(L, F, p, phi).map(([lock, amount]) => ({ lock, amount }));
  // F2 is the escape hatch (G1-01): the contract takes any amount, so the library only enforces the SDK/network floor there.
  const floor = path === 'F2' ? MIN_OUTPUT : p.dust;
  for (const o of outs) need(o.amount >= floor, 'DustOutput', `output ${o.amount} below ${path === 'F2' ? 'output floor' : 'DUST_SAFE'} ${floor}`);
  need(outs.reduce((s, o) => s + o.amount, 0n) === F, 'Conservation', 'contract outputs must sum to the contract input exactly');
  // timing: the library refuses to build a transaction the node would not accept yet (R-VM cannot see this; G3 observes it)
  let locktime = 0, seq0 = SEQ_NONFINAL;
  if (P.cltv) {
    const T = p[P.cltv]; locktime = Number(T);
    if (!ctx.dryRun) { need(ctx.tipHeight !== undefined, 'MissingContext', 'tipHeight required'); need(BigInt(ctx.tipHeight) >= T, 'TooEarly', `${path} needs chain height >= ${T}`); }
  }
  if (P.csv) {
    const N = p[P.csv]; seq0 = csvSequence(N);
    if (!ctx.dryRun) { need(ctx.confirmations !== undefined, 'MissingContext', 'confirmations required'); need(BigInt(ctx.confirmations) >= N, 'TooEarly', `${path} needs the UTXO to have >= ${N} confirmations`); }
  }
  return { path, contractKey: ck, contract, fn: P.fn, signer: P.signer, input0: { ...utxo, lockingBytecode: bytesOf(utxo.lockingBytecode), sequence: seq0 }, sponsors: sponsors.map((s) => ({ ...s, sequence: SEQ_NONFINAL })), outs, locktime, feeRate, phi };
}

// Turn a plan into a CashScript builder. keys: { V, W, A } role keys and S sponsor key (local signer / dry-run only).
export function toBuilder(plan, { provider, keys, SignatureTemplate, changeLock, fee }) {
  const sigArgs = plan.signer ? [new SignatureTemplate(keys[plan.signer], SIGHASH_61)] : [];
  const b = new TransactionBuilder({ provider, maximumFeeSatoshis: 1_000_000n });
  const c0 = { txid: plan.input0.txid, vout: plan.input0.vout, satoshis: plan.input0.satoshis, lockingBytecode: binToHex(plan.input0.lockingBytecode) };
  b.addInput(c0, plan.contract.unlock[plan.fn](...sigArgs), { sequence: plan.input0.sequence });
  let S = 0n;
  for (const s of plan.sponsors) { b.addInput({ txid: s.txid, vout: s.vout, satoshis: s.satoshis, lockingBytecode: binToHex(s.lockingBytecode) }, new SignatureTemplate(keys.S, SIGHASH_61).unlockP2PKH(), { sequence: s.sequence }); S += s.satoshis; }
  for (const o of plan.outs) b.addOutput({ to: o.lock, amount: o.amount });
  const change = S - fee;
  if (change >= MIN_OUTPUT) b.addOutput({ to: changeLock, amount: change });
  if (plan.locktime) b.setLocktime(plan.locktime);
  return b;
}

// Account for the transaction as actually serialized: version, outputs, real fee, real change.
// totalIn = contract input + sponsor inputs. Throws if anything the plan promised is not in the bytes.
export function inspectTx(plan, hex) {
  const tx = decodeTransactionBch(hexToBin(hex));
  need(typeof tx !== 'string', 'BadTx', String(tx));
  need(tx.version >= 2, 'TxVersion', `transaction version ${tx.version} < 2 (BIP68 relative locks are not enforced below version 2)`);
  const S = plan.sponsors.reduce((a, s) => a + s.satoshis, 0n);
  const totalIn = plan.input0.satoshis + S;
  const outSum = tx.outputs.reduce((a, o) => a + o.valueSatoshis, 0n);
  const n = plan.outs.length;
  // contract-funded outputs come first and must be exactly the plan; the contract value pays no fee
  const contractOut = tx.outputs.slice(0, n).reduce((a, o) => a + o.valueSatoshis, 0n);
  need(contractOut === plan.input0.satoshis, 'Conservation', 'serialized contract outputs differ from the contract input value');
  need(tx.outputs.length === n || tx.outputs.length === n + 1, 'BadTx', 'unexpected output count');
  const change = tx.outputs.length === n + 1 ? tx.outputs[n].valueSatoshis : 0n;
  const fee = totalIn - outSum;
  need(fee === S - change, 'Accounting', 'fee must equal the sponsor total minus change');
  const size = hex.length / 2;
  return { version: tx.version, locktime: tx.locktime, fee, change, hasChange: tx.outputs.length === n + 1, size, totalIn, outSum, sequences: tx.inputs.map((i) => i.sequenceNumber) };
}

// Build with a fee that matches the real size at feeRate. The returned fee/change are read back from the
// serialized transaction, never from the target. If the leftover would be below MIN_OUTPUT the change output is
// dropped and the whole sponsor remainder becomes fee; that is only allowed while the ACTUAL fee rate stays
// within MAX_FEE_RATE (FEE_SLACK sat of rounding allowed), otherwise the build is refused.
export function buildTx(plan, opts) {
  need(opts.changeLock, 'NoChangeLock', 'sponsor change lock required');
  const S = plan.sponsors.reduce((a, s) => a + s.satoshis, 0n);
  const MARGIN = 2n; // rounding / signature-length allowance on top of size * feeRate
  // The size is learned from unchecked probe builds (no SDK fee checks), iterated to a fixed point; the real, checked
  // build happens once at the end. Pass 0 leaves >= 600 sat of change so the probe already has the change output.
  const sizeOf = (fee) => encodeTransactionBch(toBuilder(plan, { ...opts, fee }).buildLibauthTransaction(true)).length;
  let fee = S > 1200n ? S - 600n : S, settled = false;
  for (let i = 0; i < 6 && !settled; i++) {
    const next = BigInt(Math.ceil(sizeOf(fee) * plan.feeRate)) + MARGIN;
    if (S - fee < MIN_OUTPUT) { // no change output: the whole remainder S is the fee, so S itself must cover the size
      need(next <= S, 'InsufficientSponsor', `sponsor inputs (${S} sat) cannot pay the ${next} sat fee`); settled = true;
    } else if (next === fee) settled = true;
    else { fee = next; need(fee <= S, 'InsufficientSponsor', `sponsor inputs (${S} sat) cannot pay the ${fee} sat fee`); }
  }
  need(settled, 'FeeUnstable', 'fee did not converge');
  const b = toBuilder(plan, { ...opts, fee });
  let hex;
  try { hex = b.build(); } catch (e) {
    if (/FeePerByteTooLow/i.test(String(e?.name)) || /lower than the standard minimum fee/.test(String(e?.message))) throw new SpendError('InsufficientSponsor', `sponsor inputs (${S} sat) cannot pay the minimum fee`);
    throw e;
  }
  // everything returned is read back from the serialized bytes
  const a = inspectTx(plan, hex);
  need(a.fee >= BigInt(a.size), 'FeeTooLow', `actual fee ${a.fee} sat is below the 1 sat/byte relay minimum for ${a.size} bytes`);
  need(a.fee <= BigInt(a.size) * BigInt(MAX_FEE_RATE) + FEE_SLACK, 'FeeTooHigh', `actual fee ${a.fee} sat on ${a.size} bytes exceeds ${MAX_FEE_RATE} sat/byte${a.hasChange ? '' : ' (change below ' + MIN_OUTPUT + ' sat was dropped into the fee)'}`);
  return { builder: b, hex, fee: a.fee, size: a.size, change: a.change, hasChange: a.hasChange, version: a.version };
}
export { randomUtxo };
