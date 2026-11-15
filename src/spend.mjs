// GigPact transaction library, part 2: spend plans for the 16 paths.
// A "plan" is plain data (inputs, outputs, locktime, sequences) that can be reviewed and tested
// without signing; toBuilder() turns it into a CashScript TransactionBuilder for dry-run or local signing.
import { TransactionBuilder, SighashType, randomUtxo } from 'cashscript';
import { binToHex, hexToBin, decodeTransactionBch, encodeTransactionBch } from '@bitauth/libauth';
import { assertChain } from './chain.mjs';
import { SpendError, checkOutpoint, strictBytes } from './errors.mjs';
import { assertF1Funding } from './k17.mjs';

export const SEQ_NONFINAL = 0xfffffffe;      // sponsor inputs and non-CSV contract inputs (G6: no relative lock, CLTV needs non-final)
export const SIGHASH_61 = SighashType.SIGHASH_ALL | SighashType.SIGHASH_UTXOS; // on wire 0x61
export const MIN_OUTPUT = 546n;               // SDK/network floor for the sponsor change output (G7 measures real policy)
export const MAX_FEE_RATE = 2;                // sat/byte, doc 1.3 suggestion (library policy, not a contract rule)
const FEE_SLACK = 2n;                         // cap = size*MAX_FEE_RATE + FEE_SLACK. The fitted fee is ceil(size*rate) + MARGIN(2), so at rate 2 the real rate is about 2.002 sat/byte; this 2-sat allowance is deliberate and pinned in the tests
export const BIP68_DISABLE = 0x80000000, BIP68_TYPE = 0x400000, BIP68_VALUE_MASK = 0xffff;

// nSequence for a block-based BIP68 relative lock of n blocks: only the low 16 bits, disable flag and time-type flag clear.
export function csvSequence(n) {
  need(typeof n === 'bigint' && n >= 1n && n <= 0xffffn, 'BadCsvSequence', `relative lock must be 1..65535 blocks, got ${n}`);
  const seq = Number(n);
  need((seq & BIP68_DISABLE) === 0 && (seq & BIP68_TYPE) === 0 && (seq & ~BIP68_VALUE_MASK) === 0 && seq === Number(n), 'BadCsvSequence', 'sequence must be block-based with no flag bits');
  return seq;
}

const bytesOf = strictBytes;
// smallest change output the SDK/network accepts for a lock of this length: 3 * (8 + 1 + len + 148) sat, never below MIN_OUTPUT
// (P2PKH 546, P2SH32 576). Real relay policy is measured later (G7).
export const changeFloor = (lock) => { const f = BigInt(3 * (157 + bytesOf(lock).length)); return f > MIN_OUTPUT ? f : MIN_OUTPUT; };
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
// One-time copy of a caller-supplied UTXO: every property is read exactly once and the lock is copied to bytes, so
// nothing validated below can change between validation and use (getters, shared arrays, hex vs bytes).
function snap(u) {
  if (!u || typeof u !== 'object') return u;
  const c = { ...u };
  if (c.lockingBytecode !== undefined && c.lockingBytecode !== null) c.lockingBytecode = Uint8Array.from(bytesOf(c.lockingBytecode));
  return c;
}
// standard spendable shapes only: P2PKH (25 bytes), P2SH20 (23), P2SH32 (35)
const isStandardLock = (l) => (l.length === 25 && l[0] === 0x76 && l[1] === 0xa9 && l[2] === 0x14 && l[23] === 0x88 && l[24] === 0xac)
  || (l.length === 23 && l[0] === 0xa9 && l[1] === 0x14 && l[22] === 0x87)
  || (l.length === 35 && l[0] === 0xaa && l[1] === 0x20 && l[34] === 0x87);
const isCount = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0) || (typeof v === 'bigint' && v >= 0n);
const freezeAll = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) freezeAll(v); return Object.freeze(o); };

// utxo: { txid, vout, satoshis }   sponsors: [{ txid, vout, satoshis, lockingBytecode, token? }]
export function planSpend({ chain: claimed, path, utxo: utxoIn, sponsors: sponsorsIn, feeRate = 1, ctx: ctxIn, job }) {
  const P = Object.hasOwn(PATHS, path) ? PATHS[path] : undefined; need(P, 'UnknownPath', String(path));
  need(ctxIn === undefined || (ctxIn !== null && typeof ctxIn === 'object' && !Array.isArray(ctxIn)), 'BadContext', 'ctx must be a plain object');
  const utxo = snap(utxoIn), ctx = { ...(ctxIn ?? {}) };
  const sponsors = Array.isArray(sponsorsIn) ? Array.from(sponsorsIn, snap) : sponsorsIn; // Array.from: a hostile Symbol.species / own map cannot interfere
  for (const k of ['tipHeight', 'confirmations']) need(ctx[k] === undefined || isCount(ctx[k]), 'BadContext', `${k} must be a non-negative integer`);
  // Everything below (parameters, locks, contracts, tA4) comes from a FRESH verified rebuild of the claimed chain (I12).
  const chain = assertChain(claimed);
  const p = chain.params, L = chain.locks;
  const phi = ctx.phi ?? 100;
  need(phi === 100 || phi === 50, 'BadPhi', 'phi must be 100 or 50');
  const ck = P.c.includes('|') ? (phi === 100 ? 'd100' : 'd50') : P.c;
  const contract = chain.contracts[ck];
  need(utxo && typeof utxo.satoshis === 'bigint', 'BadUtxo', 'contract UTXO required');
  checkOutpoint(utxo, 'contract UTXO');
  // the supplied UTXO must really sit at the expected contract lock, and carry no CashTokens/NFTs (BCH-only boundary)
  need(utxo.lockingBytecode !== undefined && utxo.lockingBytecode !== null, 'UtxoLockMissing', 'contract UTXO must include its actual lockingBytecode');
  need(sameBytes(bytesOf(utxo.lockingBytecode), L[ck]), 'UtxoLockMismatch', `UTXO is not locked by the ${ck} contract of this chain`);
  need(!utxo.token, 'ContractUtxoToken', 'contract UTXO must carry no token or NFT (BCH-only)');
  need(Array.isArray(sponsors) && sponsors.length >= 1 && sponsors.length <= 2, 'SponsorCount', 'R-0 needs 1 or 2 sponsor inputs (2..3 inputs in total)');
  const contractLocks = ['funded', 'accepted', 'requested', 'd100', 'd50'].map((k) => L[k]);
  const seenOutpoints = new Set([`${utxo.txid.toLowerCase()}:${utxo.vout}`]);
  for (const s of sponsors) {
    need(s && !s.token, 'SponsorToken', 'sponsor inputs must carry no token or NFT (tokenCategory == 0x)');
    checkOutpoint(s, 'sponsor');
    need(typeof s.satoshis === 'bigint' && s.satoshis > 0n, 'BadSponsor', 'sponsor satoshis must be a positive bigint');
    need(s.lockingBytecode !== undefined && s.lockingBytecode !== null && bytesOf(s.lockingBytecode).length > 0, 'BadSponsor', 'sponsor needs its lockingBytecode');
    need(!contractLocks.some((cl) => sameBytes(cl, bytesOf(s.lockingBytecode))), 'SponsorIsContract', 'a sponsor input must not sit at a GigPact contract lock');
    const key = `${s.txid.toLowerCase()}:${s.vout}`;
    need(!seenOutpoints.has(key), 'SponsorDuplicate', 'sponsor outpoints must be distinct from each other and from the contract UTXO');
    seenOutpoints.add(key);
  }
  need(typeof feeRate === 'number' && feeRate >= 1 && feeRate <= MAX_FEE_RATE, 'FeeRate', `fee rate must be in [1, ${MAX_FEE_RATE}] sat/byte`);
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
    if (ctx.dryRun !== true) { need(ctx.tipHeight !== undefined, 'MissingContext', 'tipHeight required'); need(BigInt(ctx.tipHeight) >= T, 'TooEarly', `${path} needs chain height >= ${T}`); }
  }
  if (P.csv) {
    const N = p[P.csv]; seq0 = csvSequence(N);
    if (ctx.dryRun !== true) { need(ctx.confirmations !== undefined, 'MissingContext', 'confirmations required'); need(BigInt(ctx.confirmations) >= N, 'TooEarly', `${path} needs the UTXO to have >= ${N} confirmations`); }
  }
  const planOuts = outs.map((o) => ({ lock: Uint8Array.from(o.lock), amount: o.amount }));
  const plan = { path, contractLocks: contractLocks.map((l) => Uint8Array.from(l)), contractKey: ck, contract, fn: P.fn, signer: P.signer, input0: { ...utxo, sequence: seq0 }, sponsors: sponsors.map((s) => ({ ...s, sequence: SEQ_NONFINAL })), outs: planOuts, locktime, feeRate, phi: P.c.includes('|') ? phi : 100 };
  // the contract object is a live SDK object and typed arrays (locks) cannot be frozen; the plain-data fields are frozen and every lock is a private copy
  Object.freeze(plan.input0); plan.sponsors.forEach(Object.freeze); Object.freeze(plan.sponsors); planOuts.forEach(Object.freeze); Object.freeze(planOuts); Object.freeze(plan.contractLocks);
  return Object.freeze(plan);
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
  if (change >= changeFloor(changeLock)) b.addOutput({ to: changeLock, amount: change });
  if (plan.locktime) b.setLocktime(plan.locktime);
  return b;
}

// Account for the transaction as actually serialized and compare it with the plan: version, input order and
// outpoints, sequences, locktime, every contract output (lock and amount), the change output, real fee and change.
// Throws if anything the plan promised is not in the bytes. changeLock is mandatory whenever a change output exists.
export function inspectTx(plan, hex, changeLock) {
  const tx = decodeTransactionBch(hexToBin(hex));
  need(typeof tx !== 'string', 'BadTx', String(tx));
  need(tx.version >= 2, 'TxVersion', `transaction version ${tx.version} < 2 (BIP68 relative locks are not enforced below version 2)`);
  const S = plan.sponsors.reduce((a, s) => a + s.satoshis, 0n);
  const totalIn = plan.input0.satoshis + S;
  const n = plan.outs.length;
  const ins = [plan.input0, ...plan.sponsors];
  need(tx.inputs.length === ins.length, 'PlanMismatch', 'input count differs from the plan');
  ins.forEach((u, i) => {
    need(binToHex(tx.inputs[i].outpointTransactionHash) === u.txid.toLowerCase() && tx.inputs[i].outpointIndex === u.vout, 'PlanMismatch', `input ${i} outpoint differs from the plan`);
    need(tx.inputs[i].sequenceNumber === u.sequence, 'PlanMismatch', `input ${i} nSequence differs from the plan`);
  });
  need(tx.locktime === plan.locktime, 'PlanMismatch', 'locktime differs from the plan');
  need(tx.outputs.length === n || tx.outputs.length === n + 1, 'BadTx', 'unexpected output count');
  plan.outs.forEach((o, i) => {
    need(tx.outputs[i].valueSatoshis === o.amount && sameBytes(tx.outputs[i].lockingBytecode, bytesOf(o.lock)), 'PlanMismatch', `contract output ${i} differs from the plan`);
    need(!tx.outputs[i].token, 'PlanMismatch', `contract output ${i} carries a token`);
  });
  const outSum = tx.outputs.reduce((a, o) => a + o.valueSatoshis, 0n);
  const contractOut = tx.outputs.slice(0, n).reduce((a, o) => a + o.valueSatoshis, 0n);
  need(contractOut === plan.input0.satoshis, 'Conservation', 'serialized contract outputs differ from the contract input value');
  const hasChange = tx.outputs.length === n + 1;
  const change = hasChange ? tx.outputs[n].valueSatoshis : 0n;
  if (hasChange) {
    need(changeLock, 'NoChangeLock', 'changeLock is required to inspect a transaction that has a change output');
    need(change >= changeFloor(changeLock), 'BadTx', 'change output below the output floor');
    need(!tx.outputs[n].token, 'PlanMismatch', 'change output carries a token');
    need(changeLock, 'NoChangeLock', 'changeLock is required to inspect a transaction that has a change output');
    need(sameBytes(tx.outputs[n].lockingBytecode, bytesOf(changeLock)), 'PlanMismatch', 'change output lock differs from changeLock');
  }
  const fee = totalIn - outSum;
  need(fee === S - change && fee >= 0n, 'Accounting', 'fee must equal the sponsor total minus change');
  return { version: tx.version, locktime: tx.locktime, fee, change, hasChange, size: hex.length / 2, totalIn, outSum, sequences: tx.inputs.map((i) => i.sequenceNumber) };
}

// Build with a fee that matches the real size at feeRate. Two shapes exist and both sizes are fixed (Schnorr
// signatures and 8-byte amounts are fixed width), so no iteration is needed: the with-change shape is used whenever the
// fitted fee leaves at least MIN_OUTPUT of change; otherwise the change output is dropped and the WHOLE sponsor
// remainder becomes the fee, which must still pass the fee-rate cap. Returned fee/change are read back from the bytes.
export function buildTx(plan, optsIn) {
  need(optsIn.changeLock, 'NoChangeLock', 'sponsor change lock required');
  const changeLock = Uint8Array.from(bytesOf(optsIn.changeLock)); // hex or bytes in, bytes used everywhere below
  need(isStandardLock(changeLock), 'BadChangeLock', 'change lock must be a standard P2PKH, P2SH20 or P2SH32 locking bytecode');
  const opts = { ...optsIn, changeLock };
  need(!plan.contractLocks.some((l) => sameBytes(l, changeLock)), 'ChangeToContract', 'change must not be sent to a GigPact contract lock');
  need(typeof plan.feeRate === 'number' && plan.feeRate >= 1 && plan.feeRate <= MAX_FEE_RATE, 'FeeRate', `fee rate must be in [1, ${MAX_FEE_RATE}] sat/byte`);
  const S = plan.sponsors.reduce((a, s) => a + s.satoshis, 0n);
  // The 2-sat MARGIN is part of the fee target, so a remainder within MARGIN of MIN_OUTPUT is treated as 'no change'
  // (the change output is dropped, not shrunk). This shifts the 546 boundary by 2 sat and is pinned in the tests.
  const MARGIN = 2n;
  const sizeOf = (fee) => encodeTransactionBch(toBuilder(plan, { ...opts, fee }).buildLibauthTransaction(true)).length;
  const need_ = (size) => BigInt(Math.ceil(size * plan.feeRate)) + MARGIN;
  let fee;
  const floor = changeFloor(changeLock);
  const feeC = S > floor ? need_(sizeOf(S - floor)) : undefined; // fee for the with-change shape
  if (feeC !== undefined && S - feeC >= floor) fee = feeC;
  else {
    const feeN = need_(sizeOf(S)); // no change output: fee == S
    need(feeN <= S, 'InsufficientSponsor', `sponsor inputs (${S} sat) cannot pay the ${feeN} sat fee`);
    fee = S;
  }
  const b = toBuilder(plan, { ...opts, fee });
  let hex;
  try { hex = b.build(); } catch (e) {
    if (/FeePerByteTooLow/i.test(String(e?.name)) || /lower than the standard minimum fee/.test(String(e?.message))) throw new SpendError('InsufficientSponsor', `sponsor inputs (${S} sat) cannot pay the minimum fee`);
    throw e;
  }
  const a = inspectTx(plan, hex, changeLock);
  need(a.fee >= BigInt(a.size), 'FeeTooLow', `actual fee ${a.fee} sat is below the 1 sat/byte relay minimum for ${a.size} bytes`);
  need(a.fee <= BigInt(a.size) * BigInt(MAX_FEE_RATE) + FEE_SLACK, 'FeeTooHigh', `actual fee ${a.fee} sat on ${a.size} bytes exceeds ${MAX_FEE_RATE} sat/byte${a.hasChange ? '' : ' (change below ' + MIN_OUTPUT + ' sat was dropped into the fee)'}`);
  return { builder: b, hex, fee: a.fee, size: a.size, change: a.change, hasChange: a.hasChange, version: a.version };
}
export { randomUtxo };
