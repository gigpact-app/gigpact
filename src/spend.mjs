// GigPact transaction library, part 2: spend plans for the 16 paths.
// A "plan" is plain data (inputs, outputs, locktime, sequences) that can be reviewed and tested
// without signing; toBuilder() turns it into a CashScript TransactionBuilder for dry-run or local signing.
import { TransactionBuilder, SighashType, randomUtxo } from 'cashscript';
import { binToHex } from '@bitauth/libauth';
import { SpendError } from './errors.mjs';
import { assertF1Funding } from './k17.mjs';

export const SEQ_NONFINAL = 0xfffffffe;      // sponsor inputs and non-CSV contract inputs (G6: no relative lock, CLTV needs non-final)
export const SIGHASH_61 = SighashType.SIGHASH_ALL | SighashType.SIGHASH_UTXOS; // on wire 0x61
export const MIN_OUTPUT = 546n;               // SDK/network floor for the sponsor change output (G7 measures real policy)
export const MAX_FEE_RATE = 2;                // sat/byte, doc 1.3 suggestion
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
  need(Array.isArray(sponsors) && sponsors.length >= 1 && sponsors.length <= 2, 'SponsorCount', 'R-0 needs 1 or 2 sponsor inputs (2..3 inputs in total)');
  for (const s of sponsors) need(!s.token, 'SponsorToken', 'sponsor inputs must carry no token or NFT (tokenCategory == 0x)');
  need(feeRate > 0 && feeRate <= MAX_FEE_RATE, 'FeeRate', `fee rate must be in (0, ${MAX_FEE_RATE}] sat/byte`);
  if (path === 'F1') { need(job, 'K17NotDeclared', 'F1 needs the job record (K17)'); assertF1Funding(job, utxo); }
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
    const N = p[P.csv]; seq0 = Number(N);
    if (!ctx.dryRun) { need(ctx.confirmations !== undefined, 'MissingContext', 'confirmations required'); need(BigInt(ctx.confirmations) >= N, 'TooEarly', `${path} needs the UTXO to have >= ${N} confirmations`); }
  }
  return { path, contractKey: ck, contract, fn: P.fn, signer: P.signer, input0: { ...utxo, lockingBytecode: L[ck], sequence: seq0 }, sponsors: sponsors.map((s) => ({ ...s, sequence: SEQ_NONFINAL })), outs, locktime, feeRate, phi };
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

// Build with a fee that matches the real size at feeRate (two passes; size barely changes with the change amount).
export function buildTx(plan, opts) {
  need(opts.changeLock, 'NoChangeLock', 'sponsor change lock required');
  const S = plan.sponsors.reduce((a, s) => a + s.satoshis, 0n);
  const MARGIN = 2n; // signature DER length jitter (71/72 bytes) can change the size by a byte or two between builds
  // pass 0 leaves >= 600 sat of change so the probe build already contains the change output (same size as the final one)
  let fee = S > 1200n ? S - 600n : S, hex, b;
  for (let i = 0; i < 4; i++) {
    b = toBuilder(plan, { ...opts, fee });
    hex = b.build();
    const next = BigInt(Math.ceil((hex.length / 2) * plan.feeRate)) + MARGIN;
    if (i > 0 && next <= fee && fee - next <= 2n * MARGIN + 2n) return { builder: b, hex, fee, size: hex.length / 2, change: S - fee };
    fee = next;
    need(fee < S, 'InsufficientSponsor', `sponsor inputs (${S} sat) cannot pay the ${fee} sat fee`);
  }
  throw new SpendError('FeeUnstable', 'fee did not converge');
}
export { randomUtxo };
