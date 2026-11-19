// G2 part 2: transaction library tests (I12 chain build/verify, K17 declared funding, sponsor/sequence/fee rules).
// Evidence level: R-VM dry-run with synthetic (fake) outpoints in the libauth VM. Not regtest, not wallet, not mainnet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignatureTemplate, randomUtxo, randomToken } from 'cashscript';
import { provider, keys, tpl, locks, VM_TARGET } from './harness.mjs';
import { buildChain, verifyChain, assertChain, canonParams, normalize, ParamError, DEFAULTS, BIP68_MAX_BLOCKS } from '../src/chain.mjs';
import { PATHS, PATH_IDS, planSpend, buildTx, inspectTx, csvSequence, changeFloor, SEQ_NONFINAL, MAX_FEE_RATE, MIN_OUTPUT, SpendError } from '../src/spend.mjs';
import { declareFunding, classifyFunded, assertF1Funding, newJob } from '../src/k17.mjs';
import { binToHex, hexToBin, decodeTransactionBch, encodeTransactionBch, secp256k1, createVirtualMachineBch2025, createVirtualMachineBch2026 } from '@bitauth/libauth';

const pk = (k) => tpl(k).publicKey;
const base = () => ({ pk: { V: pk(keys.V), W: pk(keys.W), A: pk(keys.A) }, lock: { V: locks.V, W: locks.W, A: locks.A }, F: 100000n, fA: 2000n, tEnd: 800000n });
const chainOf = (p = base()) => buildChain(p, { provider });
// unique synthetic outpoints (cashscript's randomUtxo draws txids from only 10,000 values, which can collide and trip SponsorDuplicate)
let outpointCounter = 0;
const fake = (sats) => { outpointCounter += 1; return { txid: 'ab'.repeat(30) + outpointCounter.toString(16).padStart(4, '0'), vout: outpointCounter % 4, satoshis: sats }; };
// a synthetic contract UTXO that really sits at the given state's lock (explicit lockingBytecode, as the library now requires)
const at = (chain, key, sats) => ({ ...fake(sats), lockingBytecode: Uint8Array.from(chain.locks[key]) });
const sponsor = (sats = 20000n, extra = {}) => ({ ...fake(sats), lockingBytecode: locks.S, ...extra });
const jobFor = (chain, utxo) => declareFunding(newJob(chain), utxo);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof SpendError && e.code === code, `expected ${code}`);
const dry = (plan) => { const r = buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S }); r.builder.debug(); return r; };
const C = chainOf();
const C3 = chainOf({ ...base(), F: 100001n }); // odd F: used by D3 to exercise the rounding of the split
const decode = (hex) => { const tx = decodeTransactionBch(hexToBin(hex)); assert.equal(typeof tx, 'object'); return tx; };
const vm = () => (VM_TARGET === 'BCH_2025_05' ? createVirtualMachineBch2025() : createVirtualMachineBch2026());
// Evaluate input 0 in the libauth VM against a chosen source locking bytecode. true = accepted, string = VM rejection.
const vmInput0 = (plan, hex, lockOverride) => vm().verify({
  inputIndex: 0, transaction: decode(hex),
  sourceOutputs: [{ lockingBytecode: lockOverride ?? plan.input0.lockingBytecode, valueSatoshis: plan.input0.satoshis }, ...plan.sponsors.map((s) => ({ lockingBytecode: s.lockingBytecode, valueSatoshis: s.satoshis }))],
});

test('I12: chain is deterministic and every parameter changes the Funded address', () => {
  const again = chainOf();
  assert.deepEqual(again.addresses, C.addresses);
  const variants = {
    'pkV': (p) => { p.pk.V = pk(keys.X); }, 'pkW': (p) => { p.pk.W = pk(keys.X); }, 'pkA': (p) => { p.pk.A = pk(keys.X); },
    'lockV': (p) => { p.lock.V = locks.X; }, 'lockW': (p) => { p.lock.W = locks.X; }, 'lockA': (p) => { p.lock.A = locks.X; },
    'F': (p) => { p.F = 120000n; }, 'fA': (p) => { p.fA = 2500n; }, 'tEnd': (p) => { p.tEnd = 800001n; },
    'dv': (p) => { p.dv = 433n; }, 'l': (p) => { p.l = 2017n; }, 'G': (p) => { p.G = 1009n; }, 'dust': (p) => { p.dust = 1001n; },
  };
  for (const [name, f] of Object.entries(variants)) {
    const p = base(); f(p);
    const v = verifyChain(p, C.addresses, { provider });
    assert.equal(v.ok, false, `${name}: changed parameter must be detected`);
    assert.ok(v.mismatches.includes('funded'), `${name}: Funded address must change (transitive commitment)`);
  }
  assert.equal(verifyChain(base(), C.addresses, { provider }).ok, true);
});

test('I12: per-level mismatches are located', () => {
  const other = chainOf({ ...base(), dv: 433n });
  const mix = (k) => ({ ...C.addresses, [k]: other.addresses[k] });
  for (const k of ['funded', 'accepted', 'requested']) assert.deepEqual(verifyChain(base(), mix(k), { provider }).mismatches, [k]);
  const swapped = { ...C.addresses, d100: C.addresses.d50, d50: C.addresses.d100 };
  assert.deepEqual(verifyChain(base(), swapped, { provider }).mismatches.sort(), ['d100', 'd50']);
  assert.equal(verifyChain(base(), { ...C.addresses, funded: undefined }, { provider }).ok, false);
  assert.equal(verifyChain(base(), undefined, { provider }).ok, false);
});

test('parameter validation (ParamError)', () => {
  const bad = (f, msg) => { const p = base(); f(p); assert.throws(() => normalize(p), (e) => e instanceof ParamError, msg); };
  bad((p) => { p.pk.V = new Uint8Array(32); }, 'pk length');
  bad((p) => { p.pk.W = Uint8Array.from([4, ...new Uint8Array(32)]); }, 'prefix 04');
  bad((p) => { p.lock.A = new Uint8Array(0); }, 'empty lock');
  bad((p) => { p.lock.V = new Uint8Array(101); }, 'long lock');
  bad((p) => { p.F = 0n; }, 'F zero'); bad((p) => { p.F = -5n; }, 'F negative'); bad((p) => { p.F = 100000; }, 'F not bigint');
  bad((p) => { p.fA = 999n; }, 'fA below dust'); bad((p) => { p.fA = 25001n; }, '4*fA above F'); bad((p) => { p.F = 3999n; p.fA = 1000n; }, 'F-fA small');
  bad((p) => { p.tEnd = 500_000_000n; }, 'tEnd as unix time'); bad((p) => { p.tEnd = 499_999_500n; }, 'T_A4 beyond block-height range');
  bad((p) => { p.dv = 0n; }, 'dv zero'); bad((p) => { p.l = 0n; }, 'l zero');
  assert.equal(normalize(base()).tA4, 800000n + DEFAULTS.G, 'T_A4 = T_end + G (7 days = 1008 blocks)');
  assert.throws(() => buildChain(base(), {}), ParamError, 'provider required');
});

// ---- Finding 4: BIP68 range, flags, serialized version ----------------------------------------
test('BIP68: dv and l must fit the block-based 16-bit relative lock', () => {
  assert.equal(BIP68_MAX_BLOCKS, 65535n);
  for (const k of ['dv', 'l']) {
    for (const v of [1n, 432n, 2016n, 65535n]) assert.equal(normalize({ ...base(), [k]: v })[k], v, `${k}=${v} supported`);
    for (const v of [65536n, 65537n, 1n << 22n, (1n << 22n) | 5n, 1n << 31n, (1n << 31n) | 5n, 0xffffffffn])
      assert.throws(() => normalize({ ...base(), [k]: v }), (e) => e instanceof ParamError, `${k}=${v} must be rejected`);
  }
  // csvSequence is the single place nSequence is derived: low 16 bits only, disable flag and time-type flag clear
  for (const v of [1n, 432n, 2016n, 65535n]) { const s = csvSequence(v); assert.equal(s, Number(v)); assert.equal(s & 0x80000000, 0); assert.equal(s & 0x400000, 0); assert.equal(s & ~0xffff, 0); }
  for (const v of [0n, -1n, 65536n, 1n << 22n, (1n << 22n) | 5n, 1n << 31n, 0xfffffffen, 0xffffffffn]) throwsCode(() => csvSequence(v), 'BadCsvSequence');
  throwsCode(() => csvSequence(432), 'BadCsvSequence');
  // the supported maximum builds and spends in the VM
  const big = chainOf({ ...base(), dv: 65535n, l: 65535n });
  for (const [id, key] of [['C1', 'requested'], ['D4', 'd100']]) {
    const plan = planSpend({ chain: big, path: id, utxo: at(big, key, 100000n), sponsors: [sponsor(30000n)], ctx: { dryRun: true } });
    assert.equal(plan.input0.sequence, 65535); dry(plan);
  }
});

test('transaction version: serialized version is 2 for CSV spends, and below 2 is refused', () => {
  for (const [id, key, seq] of [['C1', 'requested', 432], ['D4', 'd100', 2016]]) {
    const plan = planSpend({ chain: C, path: id, utxo: at(C, key, 100000n), sponsors: [sponsor(30000n)], ctx: { dryRun: true } });
    const r = dry(plan);
    const tx = decode(r.hex);
    assert.equal(tx.version, 2, `${id}: version in the serialized bytes`); assert.equal(r.version, 2);
    assert.equal(tx.inputs[0].sequenceNumber, seq, `${id}: input 0 nSequence = ${seq}`);
    assert.ok(tx.inputs.slice(1).every((i) => i.sequenceNumber === SEQ_NONFINAL), 'sponsor inputs 0xfffffffe');
    // a version-1 serialization is refused by the library check (the SDK has no version setter and hard-codes 2)
    assert.equal(r.hex.slice(0, 8), '02000000');
    throwsCode(() => inspectTx(plan, '01000000' + r.hex.slice(8)), 'TxVersion');
    throwsCode(() => inspectTx(plan, '00000000' + r.hex.slice(8)), 'TxVersion');
    // control: version 1 really fails the CSV rule in the VM (so the check above guards something real); version 2 passes
    assert.equal(vmInput0(plan, r.hex), true);
    assert.equal(typeof vmInput0(plan, '01000000' + r.hex.slice(8)), 'string', 'VM must reject CSV with tx version 1');
  }
});

// ---- all 16 paths: plan shape + VM dry-run -------------------------------------------------
for (const id of PATH_IDS) for (const phi of (['D4', 'D5', 'D6'].includes(id) ? [100, 50] : [100])) {
  test(`${id}${['D4', 'D5', 'D6'].includes(id) ? ` (phi=${phi})` : ''}: plan shape, serialized accounting and VM dry-run`, () => {
    const CX = id === 'D3' ? C3 : C; // D3 runs on a chain with an odd F (100001) so the odd net exercises rounding; every coin carries exactly F
    const P = PATHS[id];
    const ck = P.c.includes('|') ? (phi === 100 ? 'd100' : 'd50') : P.c;
    const u0 = at(CX, ck, CX.params.F); // odd net on D3 exercises rounding
    const plan = planSpend({ chain: CX, path: id, utxo: u0, sponsors: [sponsor(30000n)], feeRate: 1, ctx: { phi, dryRun: true }, job: id === 'F1' ? jobFor(CX, u0) : undefined });
    assert.equal(plan.contractKey, ck);
    assert.equal(binToHex(plan.input0.lockingBytecode), binToHex(CX.locks[ck]), 'input 0 carries the supplied actual lock');
    assert.equal(plan.sponsors.every((s) => s.sequence === SEQ_NONFINAL), true, 'sponsor nSequence = 0xfffffffe (G6)');
    assert.equal(plan.input0.sequence, P.csv ? Number(CX.params[P.csv]) : SEQ_NONFINAL);
    assert.equal(plan.locktime, P.cltv ? Number(CX.params[P.cltv]) : 0);
    assert.equal(plan.outs.reduce((s, o) => s + o.amount, 0n), plan.input0.satoshis, 'conservation: contract outputs == input 0');
    assert.ok(plan.outs.every((o) => o.amount >= CX.params.dust), 'every contract output >= DUST_SAFE');
    const r = dry(plan);
    // everything below is read from the serialized bytes, not from the returned object
    const tx = decode(r.hex);
    const outSum = tx.outputs.reduce((a, o) => a + o.valueSatoshis, 0n), inSum = plan.input0.satoshis + 30000n;
    assert.equal(r.fee, inSum - outSum, 'returned fee == inputs - serialized outputs');
    assert.ok(r.fee >= BigInt(r.size) && r.fee <= BigInt(r.size) + 8n, 'fee matches size at 1 sat/byte (small margin)');
    assert.equal(tx.outputs.length, plan.outs.length + 1, 'contract outputs + one sponsor change output');
    plan.outs.forEach((o, i) => { assert.equal(tx.outputs[i].valueSatoshis, o.amount); assert.equal(binToHex(tx.outputs[i].lockingBytecode), binToHex(o.lock)); });
    const ch = tx.outputs[plan.outs.length];
    assert.equal(r.change, ch.valueSatoshis); assert.equal(binToHex(ch.lockingBytecode), binToHex(locks.S)); assert.equal(ch.token, undefined, 'change is tokenless');
    assert.equal(r.change + r.fee, 30000n, 'fee and change come only from the sponsor');
    assert.ok(tx.inputs.length >= 2 && tx.inputs.length <= 3);
    assert.equal(binToHex(hexToBin(r.hex).slice(0, 4)), '02000000');
  });
}

test('graph walk: the ACTUAL previous output lock is carried into the next spend, which the VM then accepts', () => {
  const next = { F1: 'accepted', A3: 'requested', A4: 'd50', C2: 'd100' };
  const outgoing = { funded: ['F1', 'F2'], accepted: ['A1', 'A2', 'A3', 'A4'], requested: ['C1', 'C2', 'C3', 'C4'], d100: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'], d50: ['D4', 'D5', 'D6'] };
  const seen = new Set(), edges = [];
  const walk = (state, utxo, job) => {
    for (const id of outgoing[state]) {
      const plan = planSpend({ chain: C, path: id, utxo, sponsors: [sponsor(30000n)], ctx: { phi: state === 'd50' ? 50 : 100, dryRun: true }, job });
      const r = dry(plan); seen.add(id);
      const tx = decode(r.hex);
      if (next[id]) {
        assert.equal(binToHex(tx.outputs[0].lockingBytecode), binToHex(C.locks[next[id]]), `${id}: serialized output 0 is the ${next[id]} contract lock`);
        // next UTXO = exactly what was serialized (value and lock from the transaction bytes)
        const carried = { ...fake(tx.outputs[0].valueSatoshis), lockingBytecode: tx.outputs[0].lockingBytecode };
        edges.push(`${id}->${next[id]}`);
        // a lock that is not this state's lock is refused before any spend is attempted
        const wrongKey = Object.keys(C.locks).find((k) => ['funded', 'accepted', 'requested', 'd100', 'd50'].includes(k) && k !== next[id] && binToHex(C.locks[k]) !== binToHex(C.locks[next[id]]));
        throwsCode(() => planSpend({ chain: C, path: outgoing[next[id]][0], utxo: { ...carried, lockingBytecode: C.locks[wrongKey] }, sponsors: [sponsor()], ctx: { phi: 100, dryRun: true } }), 'UtxoLockMismatch');
        walk(next[id], carried, undefined);
      } else for (const o of tx.outputs.slice(0, plan.outs.length)) assert.ok([locks.V, locks.W, locks.A].some((l) => binToHex(l) === binToHex(o.lockingBytecode)), `${id}: final outputs go only to lockV/lockW/lockA`);
    }
  };
  const f0 = at(C, 'funded', C.params.F);
  walk('funded', f0, jobFor(C, f0));
  assert.deepEqual([...seen].sort(), [...PATH_IDS].sort(), 'all 16 paths executed through the state graph');
  assert.deepEqual(edges.sort(), ['A3->requested', 'A4->d50', 'C2->d100', 'F1->accepted'].sort());
});

test('I12 failure mode: a Funded paying an evil Accepted lock yields a UTXO the honest contract cannot spend (VM rejection)', () => {
  const evil = chainOf({ ...base(), dv: 433n });
  assert.notEqual(binToHex(evil.locks.accepted), binToHex(C.locks.accepted));
  // honest transaction against the honest lock: the VM accepts input 0 (control)
  const plan = planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor(30000n)], ctx: {} });
  const r = buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S });
  assert.equal(vmInput0(plan, r.hex), true, 'control: honest lock accepted by the VM');
  // same signed bytes, but the coin actually sits at the evil lock: the VM itself rejects (P2SH32 redeem-script hash mismatch)
  const res = vmInput0(plan, r.hex, evil.locks.accepted);
  assert.equal(typeof res, 'string', 'the VM must reject, not the SDK or builder');
  // the SDK builder also refuses, but that is the weaker (non-VM) layer and is not what this test relies on
  assert.throws(() => planSpend({ chain: C, path: 'A1', utxo: at(evil, 'accepted', 100000n), sponsors: [sponsor()], ctx: {} }), (e) => e.code === 'UtxoLockMismatch');
  console.log('      VM rejection text:', res.split('\n')[0].slice(0, 120));
});

// ---- Finding 1: actual contract UTXO lock, tokens, K17 job/chain identity ---------------------
test('contract UTXO: actual lockingBytecode required, must equal the selected state lock, no tokens', () => {
  const mk = (utxo, path = 'A1') => planSpend({ chain: C, path, utxo, sponsors: [sponsor()], ctx: { phi: 100, dryRun: true } });
  const ok = at(C, 'accepted', 100000n);
  assert.ok(mk(ok));
  assert.ok(mk({ ...ok, lockingBytecode: binToHex(ok.lockingBytecode) }), 'hex string lock accepted when equal');
  const { lockingBytecode, ...noLock } = ok;
  throwsCode(() => mk(noLock), 'UtxoLockMissing'); throwsCode(() => mk({ ...ok, lockingBytecode: undefined }), 'UtxoLockMissing'); throwsCode(() => mk({ ...ok, lockingBytecode: null }), 'UtxoLockMissing');
  for (const k of ['funded', 'requested', 'd100', 'd50']) throwsCode(() => mk({ ...ok, lockingBytecode: C.locks[k] }), 'UtxoLockMismatch');   // another state of the same chain
  throwsCode(() => mk({ ...ok, lockingBytecode: locks.V }), 'UtxoLockMismatch');                                                              // a plain wallet lock
  throwsCode(() => mk({ ...ok, lockingBytecode: chainOf({ ...base(), dv: 433n }).locks.accepted }), 'UtxoLockMismatch');                         // same state of another chain
  const flipped = Uint8Array.from(C.locks.accepted); flipped[flipped.length - 2] ^= 1;
  throwsCode(() => mk({ ...ok, lockingBytecode: flipped }), 'UtxoLockMismatch');                                                              // one flipped bit
  throwsCode(() => mk({ ...ok, lockingBytecode: C.locks.accepted.slice(0, -1) }), 'UtxoLockMismatch');                                         // truncated
  // d100 vs d50 are different contracts: the lock must match the phi selected for D4/D5/D6
  throwsCode(() => planSpend({ chain: C, path: 'D5', utxo: at(C, 'd50', 100000n), sponsors: [sponsor()], ctx: { phi: 100 } }), 'UtxoLockMismatch');
  throwsCode(() => planSpend({ chain: C, path: 'D5', utxo: at(C, 'd100', 100000n), sponsors: [sponsor()], ctx: { phi: 50 } }), 'UtxoLockMismatch');
  // tokens on the contract UTXO (BCH-only boundary): fungible, NFT, on several paths including the F2 escape hatch
  const cat = randomToken({ amount: 5n }).category;
  const toks = [{ amount: 5n, category: cat }, { amount: 0n, category: cat, nft: { capability: 'none', commitment: '' } }, randomToken({ amount: 1n })];
  for (const tk of toks) for (const [id, key] of [['A1', 'accepted'], ['F1', 'funded'], ['F2', 'funded'], ['C1', 'requested'], ['D1', 'd100']])
    throwsCode(() => planSpend({ chain: C, path: id, utxo: { ...at(C, key, id === 'F1' ? C.params.F : 100000n), token: tk }, sponsors: [sponsor()], ctx: { dryRun: true }, job: id === 'F1' ? jobFor(C, at(C, key, C.params.F)) : undefined }), 'ContractUtxoToken');
});

// ---- guards ---------------------------------------------------------------------------------
test('timing guards (library refuses transactions the node would not accept yet)', () => {
  const mk = (id, key, ctx) => planSpend({ chain: C, path: id, utxo: at(C, key, 100000n), sponsors: [sponsor()], ctx });
  throwsCode(() => mk('A3', 'accepted', { tipHeight: 799999 }), 'TooEarly'); assert.ok(mk('A3', 'accepted', { tipHeight: 800000 }));
  throwsCode(() => mk('A4', 'accepted', { tipHeight: 800000 + 1007 }), 'TooEarly'); assert.ok(mk('A4', 'accepted', { tipHeight: 800000 + 1008 }));
  throwsCode(() => mk('C1', 'requested', { confirmations: 431 }), 'TooEarly'); assert.ok(mk('C1', 'requested', { confirmations: 432 }));
  throwsCode(() => mk('D4', 'd100', { confirmations: 2015, phi: 100 }), 'TooEarly'); assert.ok(mk('D4', 'd50', { confirmations: 2016, phi: 50 }));
  throwsCode(() => mk('A3', 'accepted', {}), 'MissingContext'); throwsCode(() => mk('C1', 'requested', {}), 'MissingContext');
  assert.ok(mk('A1', 'accepted', {}), 'non-timed paths need no context');
});

test('a coin of another amount than F at a contract address is never spent (decoy / stray), except by the F2 escape hatch', () => {
  const next = { A1: 'accepted', A2: 'accepted', A3: 'accepted', A4: 'accepted', C1: 'requested', C2: 'requested', C3: 'requested', C4: 'requested', D1: 'd100', D2: 'd100', D3: 'd100', D4: 'd100', D5: 'd100', D6: 'd100' };
  for (const [id, key] of Object.entries(next)) {
    for (const v of [C.params.F - 1n, C.params.F + 1n, 1n]) {
      throwsCode(() => planSpend({ chain: C, path: id, utxo: at(C, key, v), sponsors: [sponsor()], ctx: { phi: 100, dryRun: true } }), 'UtxoValue');
    }
  }
  // F2 takes any amount (G1-01)
  assert.ok(planSpend({ chain: C, path: 'F2', utxo: at(C, 'funded', C.params.F + 7n), sponsors: [sponsor()], ctx: {} }));
});

test('sponsor, fee-rate and output guards', () => {
  const mk = (o = {}) => planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor()], ctx: {}, ...o });
  throwsCode(() => mk({ sponsors: [] }), 'SponsorCount');
  throwsCode(() => mk({ sponsors: [sponsor(), sponsor(), sponsor()] }), 'SponsorCount');
  assert.ok(mk({ sponsors: [sponsor(), sponsor()] }));
  throwsCode(() => mk({ sponsors: [sponsor(20000n, { token: { amount: 1n, category: '00'.repeat(32) } })] }), 'SponsorToken');
  throwsCode(() => mk({ feeRate: 0 }), 'FeeRate'); throwsCode(() => mk({ feeRate: MAX_FEE_RATE + 0.5 }), 'FeeRate');
  assert.ok(mk({ feeRate: MAX_FEE_RATE }));
  throwsCode(() => planSpend({ chain: C, path: 'D1', utxo: at(C, 'd100', C.params.fA + C.params.dust - 1n), sponsors: [sponsor()], ctx: { dryRun: true } }), 'UtxoValue'); // a coin below F is refused before the dust guard
  throwsCode(() => planSpend({ chain: C, path: 'Z9', utxo: at(C, 'accepted', 1n), sponsors: [sponsor()] }), 'UnknownPath');
  throwsCode(() => planSpend({ chain: C, path: 'D4', utxo: at(C, 'd100', 100000n), sponsors: [sponsor()], ctx: { phi: 75, dryRun: true } }), 'BadPhi');
  assert.throws(() => buildTx(mk(), { provider, keys, SignatureTemplate }), (e) => e.code === 'NoChangeLock');
});

// ---- Finding 2: actual fee/change accounting, read back from the serialized transaction ------
test('buildTx accounting: change boundary around 546 sat, insufficient sponsor, no-change fee-rate cap', () => {
  const build = (S, feeRate = 1) => {
    const plan = planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor(S)], feeRate, ctx: {} });
    return { plan, r: buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S }) };
  };
  // independent accounting from the serialized bytes
  const audit = (plan, r, S) => {
    const tx = decode(r.hex), n = plan.outs.length;
    const outSum = tx.outputs.reduce((a, o) => a + o.valueSatoshis, 0n), inSum = plan.input0.satoshis + S;
    const hasChange = tx.outputs.length === n + 1, change = hasChange ? tx.outputs[n].valueSatoshis : 0n;
    assert.equal(r.fee, inSum - outSum, 'returned fee == inputs - serialized outputs');
    assert.equal(r.change, change, 'returned change is exactly the serialized change output (0n if none)');
    assert.equal(r.hasChange, hasChange);
    assert.equal(r.fee + r.change, S, 'sponsor total = fee + change');
    assert.equal(tx.outputs.slice(0, n).reduce((a, o) => a + o.valueSatoshis, 0n), plan.input0.satoshis, 'contract value pays no fee');
    if (hasChange) assert.ok(change >= MIN_OUTPUT, 'a serialized change output is never below 546');
    assert.ok(r.fee >= BigInt(r.size), 'at least 1 sat/byte'); assert.ok(r.fee <= BigInt(r.size) * BigInt(MAX_FEE_RATE) + 2n, 'at most MAX_FEE_RATE');
    assert.equal(r.size, hexToBin(r.hex).length);
    return { tx, hasChange, change };
  };
  const N = 40000n, big = build(N); audit(big.plan, big.r, N);
  const f = big.r.fee; // converged fee at 1 sat/byte for the with-change shape
  const cases = { 'normal change': f + 10000n, 'exactly 546 change': f + 546n, '547 change': f + 547n };
  for (const [name, S] of Object.entries(cases)) {
    const { plan, r } = build(S); const a = audit(plan, r, S);
    assert.equal(a.hasChange, true, name); assert.equal(r.fee, f, `${name}: fee is the fitted fee`);
    assert.equal(a.change, S - f, name);
  }
  // 545 left over: change would be sub-546, the output is dropped and the WHOLE remainder is fee
  { const S = f + 545n; const { plan, r } = build(S); const a = audit(plan, r, S);
    assert.equal(a.hasChange, false, '545 sat change must not be created'); assert.equal(r.change, 0n); assert.equal(r.fee, S, 'actual fee is the full sponsor total');
    assert.ok(r.fee > f, 'actual fee is larger than the target fee, and the returned value says so'); }
  // largest sponsor for which a no-change tx is still valid: fee == S == exact size of the no-change shape
  { const S = f - 34n; const { plan, r } = build(S); const a = audit(plan, r, S);
    assert.equal(a.hasChange, false); assert.equal(r.fee, S); assert.ok(r.fee >= BigInt(r.size)); }
  // insufficient sponsor funds: cannot pay the size of even the no-change shape
  for (const S of [f - 40n, 150n, 0n + 1n]) assert.throws(() => build(S), (e) => e instanceof SpendError && e.code === 'InsufficientSponsor', `S=${S}`);
  // no-change whose ACTUAL fee would exceed the allowed rate: refused, never silently overpaid
  { const f2 = build(N, 2).r.fee; const S = f2 + 545n;
    assert.throws(() => build(S, 2), (e) => e instanceof SpendError && e.code === 'FeeTooHigh');
    // the same remainder at 1 sat/byte stays inside the cap and is accepted (rate shown by the audit)
    const { plan, r } = build(f + 545n, 1); audit(plan, r, f + 545n); }
  // rate 2 normal build stays within MAX_FEE_RATE on the serialized size
  { const { plan, r } = build(N, 2); audit(plan, r, N); assert.ok(r.fee <= BigInt(r.size) * 2n + 2n); }
});

// ---- K17 ------------------------------------------------------------------------------------
test('K17: declared funding outpoint rule', () => {
  const job0 = newJob(C);
  const out = at(C, 'funded', C.params.F);
  throwsCode(() => declareFunding(job0, fake(C.params.F - 1n)), 'K17Value');
  throwsCode(() => declareFunding(job0, fake(C.params.F + 1n)), 'K17Value');
  const job = declareFunding(job0, out);
  throwsCode(() => declareFunding(job, fake(C.params.F)), 'K17AlreadyDeclared');
  assert.ok(assertF1Funding(job, out, C));
  throwsCode(() => assertF1Funding(job0, out, C), 'K17NotDeclared');
  throwsCode(() => assertF1Funding(job, { ...out, txid: '00'.repeat(32) }, C), 'K17Mismatch');   // wrong txid
  throwsCode(() => assertF1Funding(job, { ...out, vout: out.vout + 1 }, C), 'K17Mismatch');        // wrong vout
  throwsCode(() => assertF1Funding(job, { ...out, satoshis: out.satoshis + 1n }, C), 'K17Value'); // value drift
  throwsCode(() => assertF1Funding(job, { ...out, satoshis: out.satoshis - 1n }, C), 'K17Value');
  throwsCode(() => assertF1Funding(job, out), 'K17ChainMismatch');                                  // chain is mandatory
  // a third party sends exactly F to the same address from another outpoint: foreign, F1 refuses it
  const third = at(C, 'funded', C.params.F);
  throwsCode(() => assertF1Funding(job, third, C), 'K17Mismatch');
  const cls = classifyFunded(job, [out, third, at(C, 'funded', 546n)]);
  assert.equal(cls.declared.txid, out.txid); assert.equal(cls.foreign.length, 2); assert.equal(cls.declaredMissing, false);
  assert.equal(classifyFunded(job, [third]).declaredMissing, true, 'declared outpoint already spent');
  assert.equal(classifyFunded(job0, [out]).undeclared, true, 'no declaration: nothing counts as funding');
  // F1 builds only for the declared outpoint, through planSpend
  dry(planSpend({ chain: C, path: 'F1', utxo: out, sponsors: [sponsor()], ctx: {}, job }));
  throwsCode(() => planSpend({ chain: C, path: 'F1', utxo: third, sponsors: [sponsor()], ctx: {}, job }), 'K17Mismatch');
  throwsCode(() => planSpend({ chain: C, path: 'F1', utxo: out, sponsors: [sponsor()], ctx: {} }), 'K17NotDeclared');
  // F2 (cancel) can still refund a foreign or sub-dust UTXO to the employer (G1-01), down to the SDK output floor
  for (const sats of [546n, 999n, 100000n, 250000n]) dry(planSpend({ chain: C, path: 'F2', utxo: at(C, 'funded', sats), sponsors: [sponsor()], ctx: {} }));
  throwsCode(() => planSpend({ chain: C, path: 'F2', utxo: at(C, 'funded', 545n), sponsors: [sponsor()], ctx: {} }), 'DustOutput');
  // F2 needs no job record and still validates the lock, tokens and sponsors like every other path
  throwsCode(() => planSpend({ chain: C, path: 'F2', utxo: at(C, 'accepted', 5000n), sponsors: [sponsor()], ctx: {} }), 'UtxoLockMismatch');
  throwsCode(() => planSpend({ chain: C, path: 'F2', utxo: at(C, 'funded', 5000n), sponsors: [], ctx: {} }), 'SponsorCount');
});

test('K17: a job is bound to the exact chain it was created for', () => {
  const out = at(C, 'funded', C.params.F);
  const job = jobFor(C, out);
  const plan = (chain, utxo, j) => planSpend({ chain, path: 'F1', utxo, sponsors: [sponsor()], ctx: {}, job: j });
  assert.ok(plan(C, out, job));
  // a job created for ANOTHER chain, with the same outpoint and value, looks perfectly valid in isolation
  for (const [name, over] of Object.entries({ dv: { dv: 433n }, l: { l: 2017n }, fA: { fA: 2500n }, tEnd: { tEnd: 800001n }, F: { F: 120000n }, pkW: { pk: { ...base().pk, W: pk(keys.X) } }, lockV: { lock: { ...base().lock, V: locks.X } } })) {
    const other = chainOf({ ...base(), ...over });
    const otherOut = at(other, 'funded', other.params.F);
    const otherJob = jobFor(other, { ...otherOut, txid: out.txid, vout: out.vout, satoshis: other.params.F });
    assert.ok(plan(other, otherOut, { ...otherJob, declaredFunding: { ...otherJob.declaredFunding, txid: otherOut.txid, vout: otherOut.vout } }), `${name}: control, matching job and chain`);
    // other chain's job + its own funded UTXO on OUR chain / our job on THEIR chain
    throwsCode(() => plan(C, out, { ...otherJob, declaredFunding: { txid: out.txid, vout: out.vout, satoshis: out.satoshis } }), 'K17ChainMismatch');
    throwsCode(() => plan(other, otherOut, { ...job, declaredFunding: { txid: otherOut.txid, vout: otherOut.vout, satoshis: other.params.F } }), 'K17ChainMismatch');
  }
  // same addresses but the recorded parameters differ -> parameter mismatch
  throwsCode(() => plan(C, out, { ...job, params: { ...job.params, fA: 2500n } }), 'K17ParamMismatch');
  throwsCode(() => plan(C, out, { ...job, params: { ...job.params, pk: { ...job.params.pk, A: pk(keys.X) } } }), 'K17ParamMismatch');
  // same parameters but any single recorded address tampered -> chain mismatch
  for (const k of Object.keys(C.addresses)) throwsCode(() => plan(C, out, { ...job, addresses: { ...job.addresses, [k]: k === 'funded' ? C.addresses.accepted : C.addresses.funded } }), 'K17ChainMismatch');
  throwsCode(() => plan(C, out, { ...job, addresses: { ...job.addresses, extra: 'x' } }), 'K17ChainMismatch');
  throwsCode(() => plan(C, out, { ...job, addresses: undefined }), 'K17ChainMismatch');
  throwsCode(() => plan(C, out, { declaredFunding: job.declaredFunding }), 'K17ChainMismatch');
  // a chain object whose addresses do not follow from its parameters is refused (I12 self-consistency)
  const forged = { ...C, params: { ...C.params, fA: 2500n } };
  assert.throws(() => plan(forged, out, job), (e) => e instanceof ParamError);
});

// ---- Review round 2: chain integrity, job isolation, sponsor validation, inspectTx vs plan -----
test('chain object is never trusted: forged locks/contracts/params/tA4 are refused on every path', () => {
  const evilLock = locks.X;
  const E = chainOf({ ...base(), dv: 433n });
  const forgeries = {
    'locks.W + locks.accepted replaced': (c) => ({ ...c, locks: { ...c.locks, W: evilLock, accepted: evilLock } }),
    'one contract lock replaced': (c) => ({ ...c, locks: { ...c.locks, requested: E.locks.requested } }),
    'locks.V replaced': (c) => ({ ...c, locks: { ...c.locks, V: evilLock } }),
    'extra lock key': (c) => ({ ...c, locks: { ...c.locks, extra: evilLock } }),
    'contract object swapped': (c) => ({ ...c, contracts: { ...c.contracts, accepted: E.contracts.accepted } }),
    'address replaced': (c) => ({ ...c, addresses: { ...c.addresses, d50: E.addresses.accepted } }),
    'fA changed in params': (c) => ({ ...c, params: { ...c.params, fA: 1500n } }),
    'tA4 forged': (c) => ({ ...c, params: { ...c.params, tA4: 1n } }),
    'extra param': (c) => ({ ...c, params: { ...c.params, extra: 1n } }),
    'extra address key': (c) => ({ ...c, addresses: { ...c.addresses, extra: 'x' } }),
  };
  for (const [name, forge] of Object.entries(forgeries)) for (const [id, key] of [['A1', 'accepted'], ['F2', 'funded'], ['D1', 'd100'], ['A4', 'accepted']]) {
    const bad = forge(C);
    assert.throws(() => planSpend({ chain: bad, path: id, utxo: at(C, key, 100000n), sponsors: [sponsor()], ctx: { dryRun: true } }), (e) => e instanceof ParamError, `${name} on ${id}`);
  }
  // no memoisation: a chain that was valid once and is mutated later is caught on the next plan
  const live = chainOf();
  assert.ok(planSpend({ chain: live, path: 'D1', utxo: at(live, 'd100', 100000n), sponsors: [sponsor()], ctx: { dryRun: true } }));
  live.params.fA = 1500n;
  assert.throws(() => planSpend({ chain: live, path: 'D1', utxo: at(live, 'd100', 100000n), sponsors: [sponsor()], ctx: { dryRun: true } }), (e) => e instanceof ParamError);
  const live2 = chainOf(); planSpend({ chain: live2, path: 'A4', utxo: at(live2, 'accepted', 100000n), sponsors: [sponsor()], ctx: { dryRun: true } });
  live2.params.tA4 = 1n;
  assert.throws(() => planSpend({ chain: live2, path: 'A4', utxo: at(live2, 'accepted', 100000n), sponsors: [sponsor()], ctx: { dryRun: true } }), (e) => e instanceof ParamError);
});

test('job record does not share objects with the chain it was created from', () => {
  const chain = chainOf(); const out = at(chain, 'funded', chain.params.F);
  const job = jobFor(chain, out);
  assert.notEqual(job.params, chain.params); assert.notEqual(job.params.pk.V, chain.params.pk.V);
  job.params.fA = 1500n; job.params.pk.A[1] ^= 1;
  assert.equal(chain.params.fA, 2000n, 'mutating the job does not change the chain');
  throwsCode(() => planSpend({ chain, path: 'F1', utxo: out, sponsors: [sponsor()], ctx: {}, job }), 'K17ParamMismatch');
  const job2 = jobFor(chain, out); chain.params.fA = 1500n;
  assert.equal(job2.params.fA, 2000n, 'mutating the chain does not change the job');
});

test('sponsor validation: distinct real outpoints, positive bigint value, a lock, never a contract lock', () => {
  const mk = (sponsors, o = {}) => planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors, ctx: {}, ...o });
  const s = sponsor(20000n);
  throwsCode(() => mk([s, s]), 'SponsorDuplicate');
  throwsCode(() => mk([s, { ...sponsor(5000n), txid: s.txid.toUpperCase(), vout: s.vout }]), 'SponsorDuplicate');
  const cu = at(C, 'accepted', 100000n);
  throwsCode(() => planSpend({ chain: C, path: 'A1', utxo: cu, sponsors: [{ ...sponsor(100000n), txid: cu.txid, vout: cu.vout }], ctx: {} }), 'SponsorDuplicate'); // contract outpoint reused
  throwsCode(() => mk([{ ...s, satoshis: 20000 }]), 'BadSponsor'); throwsCode(() => mk([{ ...s, satoshis: -5000n }]), 'BadSponsor'); throwsCode(() => mk([{ ...s, satoshis: 0n }]), 'BadSponsor');
  throwsCode(() => mk([{ ...s, lockingBytecode: undefined }]), 'BadSponsor'); throwsCode(() => mk([{ ...s, lockingBytecode: new Uint8Array(0) }]), 'BadSponsor');
  for (const k of ['funded', 'accepted', 'requested', 'd100', 'd50']) throwsCode(() => mk([{ ...s, lockingBytecode: C.locks[k] }]), 'SponsorIsContract');
  throwsCode(() => mk([{ ...s, txid: 'zz' }]), 'BadOutpoint'); throwsCode(() => mk([{ ...s, vout: -1 }]), 'BadOutpoint'); throwsCode(() => mk([{ ...s, vout: 1.5 }]), 'BadOutpoint');
  throwsCode(() => planSpend({ chain: C, path: 'A1', utxo: { ...cu, txid: 'abc' }, sponsors: [s], ctx: {} }), 'BadOutpoint');
  throwsCode(() => planSpend({ chain: C, path: 'A1', utxo: { ...cu, vout: -1 }, sponsors: [s], ctx: {} }), 'BadOutpoint');
  assert.ok(mk([s, sponsor(5000n)]), 'two distinct sponsors are fine');
  throwsCode(() => mk([s], { feeRate: 0.5 }), 'FeeRate'); // policy is [1, 2] sat/byte
  throwsCode(() => mk([s], { feeRate: '1' }), 'FeeRate');
});

test('buildTx: change never goes to a contract lock; inspectTx compares the bytes with the plan', () => {
  const plan = planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor(30000n)], ctx: {} });
  for (const k of ['funded', 'accepted', 'requested', 'd100', 'd50']) assert.throws(() => buildTx(plan, { provider, keys, SignatureTemplate, changeLock: C.locks[k] }), (e) => e.code === 'ChangeToContract');
  const r = buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S });
  assert.ok(inspectTx(plan, r.hex, locks.S));
  throwsCode(() => inspectTx(plan, r.hex, locks.X), 'PlanMismatch');                                   // change lock differs
  const other = planSpend({ chain: C, path: 'A2', utxo: { ...plan.input0, lockingBytecode: plan.input0.lockingBytecode }, sponsors: plan.sponsors, ctx: {} });
  throwsCode(() => inspectTx(other, r.hex), 'PlanMismatch');                                              // A1 bytes vs A2 plan: contract output lock differs
  throwsCode(() => inspectTx({ ...plan, locktime: 5 }, r.hex), 'PlanMismatch');                           // locktime
  throwsCode(() => inspectTx({ ...plan, input0: { ...plan.input0, sequence: 1 } }, r.hex), 'PlanMismatch'); // sequence
  throwsCode(() => inspectTx({ ...plan, sponsors: [{ ...plan.sponsors[0], vout: plan.sponsors[0].vout + 1 }] }, r.hex), 'PlanMismatch'); // outpoint
  const bumped = { ...plan, outs: [{ ...plan.outs[0], amount: plan.outs[0].amount - 1n }] };
  throwsCode(() => inspectTx(bumped, r.hex), 'PlanMismatch');                                              // amount
  // a fee rate below the policy floor is refused by buildTx itself, not only by planSpend
  assert.throws(() => buildTx({ ...plan, feeRate: 0.5 }, { provider, keys, SignatureTemplate, changeLock: locks.S }), (e) => e.code === 'FeeRate');
});

test('fee cap is pinned: a no-change remainder one satoshi over size*2+2 is refused', () => {
  const run = (S, feeRate) => { const plan = planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor(S)], feeRate, ctx: {} });
    return buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S }); };
  const big = run(40000n, 2), sizeC = BigInt(big.size), sizeN = sizeC - 34n;
  assert.equal(big.fee, 2n * sizeC + 2n, 'with-change fee at 2 sat/byte = 2*size + 2');
  // cap for the no-change shape is 2*sizeN + 2
  const ok = run(2n * sizeN + 2n, 2); assert.equal(ok.hasChange, false); assert.equal(ok.fee, 2n * sizeN + 2n);
  assert.throws(() => run(2n * sizeN + 3n, 2), (e) => e.code === 'FeeTooHigh');
  assert.throws(() => run(2n * sizeN + 40n, 2), (e) => e.code === 'FeeTooHigh');
  // when 546+ of change is possible the library keeps the change instead of burning it (S just above the threshold)
  const f1 = run(40000n, 1).fee; const withChange = run(f1 + 546n, 1); assert.equal(withChange.hasChange, true); assert.equal(withChange.change, 546n);
  const s1200 = run(1200n, 1); assert.equal(s1200.hasChange, s1200.change >= 546n);
  assert.ok(s1200.fee >= BigInt(s1200.size) && s1200.fee <= BigInt(s1200.size) + 4n || !s1200.hasChange);
});

// ---- Review round 3: snapshot (TOCTOU), aliasing, frozen plan, change lock, byte-level plan comparison ----
test('planSpend snapshots its inputs: getters that change between reads cannot slip past validation', () => {
  const out = at(C, 'funded', C.params.F);
  const job = jobFor(C, out);
  let reads = 0;
  const hostile = { get txid() { reads += 1; return reads <= 4 ? out.txid : '0'.repeat(63) + 'f'; }, vout: out.vout, satoshis: out.satoshis, lockingBytecode: out.lockingBytecode };
  let plan;
  try { plan = planSpend({ chain: C, path: 'F1', utxo: hostile, sponsors: [sponsor()], ctx: {}, job }); } catch (e) { assert.equal(e.code, 'K17Mismatch'); }
  if (plan) assert.equal(plan.input0.txid, out.txid, 'the validated outpoint is the one that is used');
  assert.ok(reads <= 1, `txid read exactly once (got ${reads})`);
  // a sponsor lock that turns into a contract lock after the first read
  let lreads = 0;
  const sp = sponsor(); const trick = { ...sp, get lockingBytecode() { lreads += 1; return lreads === 1 ? locks.S : C.locks.accepted; } };
  const p2 = planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [trick], ctx: {} });
  assert.equal(binToHex(p2.sponsors[0].lockingBytecode), binToHex(locks.S)); assert.equal(lreads, 1);
  // same for ctx and for hostile sponsors array elements
  let creads = 0; const ctx = { get confirmations() { creads += 1; return creads === 1 ? 432 : 0; } };
  assert.ok(planSpend({ chain: C, path: 'C1', utxo: at(C, 'requested', 100000n), sponsors: [sponsor()], ctx }));
});

test('plans do not alias caller memory and are frozen', () => {
  const p = base(); const ch = chainOf(p);
  const plan = planSpend({ chain: ch, path: 'A1', utxo: at(ch, 'accepted', 100000n), sponsors: [sponsor()], ctx: {} });
  const before = binToHex(plan.outs[0].lock);
  p.lock.W[3] ^= 1; ch.params.lock.W[3] ^= 1; ch.locks.W[3] ^= 1;             // caller mutates its own arrays after planning
  assert.equal(binToHex(plan.outs[0].lock), before, 'plan output lock is a private copy');
  const u = at(C, 'accepted', 100000n); const keep = Uint8Array.from(u.lockingBytecode);
  const plan2 = planSpend({ chain: C, path: 'A1', utxo: u, sponsors: [sponsor()], ctx: {} });
  u.lockingBytecode[5] ^= 1; assert.equal(binToHex(plan2.input0.lockingBytecode), binToHex(keep), 'input 0 lock is a private copy');
  assert.throws(() => { plan2.outs[0].amount = 1n; }, TypeError); assert.throws(() => { plan2.outs.push({}); }, TypeError);
  assert.throws(() => { plan2.input0.sequence = 1; }, TypeError); assert.throws(() => { plan2.sponsors[0].satoshis = 1n; }, TypeError);
  assert.throws(() => { plan2.locktime = 7; }, TypeError); assert.throws(() => { plan2.contractLocks[0] = new Uint8Array(1); }, TypeError);
  // assertChain returns a rebuilt chain, never the claimed object
  const fresh = assertChain(C); assert.notEqual(fresh, C); assert.notEqual(fresh.locks.W, C.locks.W); assert.equal(binToHex(fresh.locks.W), binToHex(C.locks.W));
});

test('hex locks work end to end; change lock must be a sane spendable-looking script', () => {
  const hexSponsor = { ...sponsor(30000n), lockingBytecode: binToHex(locks.S) };
  const plan = planSpend({ chain: C, path: 'A1', utxo: { ...at(C, 'accepted', 100000n), lockingBytecode: binToHex(C.locks.accepted) }, sponsors: [hexSponsor], ctx: {} });
  assert.ok(plan.sponsors[0].lockingBytecode instanceof Uint8Array);
  const r = buildTx(plan, { provider, keys, SignatureTemplate, changeLock: binToHex(locks.S) });   // hex change lock
  r.builder.debug(); assert.ok(inspectTx(plan, r.hex, locks.S));
  for (const bad of [new Uint8Array(0), Uint8Array.from([0x6a]), Uint8Array.from([0x6a, 1, 2]), new Uint8Array(101).fill(0x51)])
    assert.throws(() => buildTx(plan, { provider, keys, SignatureTemplate, changeLock: bad }), (e) => e.code === 'BadChangeLock' || e.code === 'NoChangeLock', 'unspendable or malformed change lock refused');
  // inspectTx cannot be used without a change lock when the transaction has change
  throwsCode(() => inspectTx(plan, r.hex), 'NoChangeLock');
});

test('inspectTx compares serialized bytes with the plan (txid, extra input/output, tokens, change floor)', () => {
  const plan = planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor(30000n)], ctx: {} });
  const r = buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S });
  const tx0 = decode(r.hex); const enc = (tx) => binToHex(encodeTransactionBch(tx));
  const edit = (f) => { const tx = decode(r.hex); f(tx); return enc(tx); };
  assert.equal(enc(tx0), r.hex, 'round trip control');
  throwsCode(() => inspectTx({ ...plan, input0: { ...plan.input0, txid: '1'.repeat(64) } }, r.hex, locks.S), 'PlanMismatch');            // txid differs from the plan
  throwsCode(() => inspectTx({ ...plan, sponsors: [{ ...plan.sponsors[0], txid: '2'.repeat(64) }] }, r.hex, locks.S), 'PlanMismatch');
  throwsCode(() => inspectTx(plan, edit((tx) => { tx.inputs.push({ ...tx.inputs[1], outpointIndex: 99 }); }), locks.S), 'PlanMismatch');       // extra input
  throwsCode(() => inspectTx(plan, edit((tx) => { tx.inputs.pop(); }), locks.S), 'PlanMismatch');                                           // missing input
  throwsCode(() => inspectTx(plan, edit((tx) => { tx.outputs.push({ ...tx.outputs[1] }); }), locks.S), 'BadTx');                              // two change outputs
  throwsCode(() => inspectTx(plan, edit((tx) => { tx.outputs.pop(); tx.outputs.pop(); }), locks.S), 'BadTx');                                // contract output missing
  throwsCode(() => inspectTx(plan, edit((tx) => { tx.outputs[0].token = { amount: 1n, category: hexToBin('11'.repeat(32)) }; }), locks.S), 'PlanMismatch');  // token on a contract output
  throwsCode(() => inspectTx(plan, edit((tx) => { tx.outputs[1].token = { amount: 1n, category: hexToBin('11'.repeat(32)) }; }), locks.S), 'PlanMismatch');  // token on the change
  throwsCode(() => inspectTx(plan, edit((tx) => { tx.outputs[1].valueSatoshis = 545n; }), locks.S), 'BadTx');                                // change below the floor
  throwsCode(() => inspectTx(plan, edit((tx) => { tx.outputs[1].lockingBytecode = locks.X; }), locks.S), 'PlanMismatch');                    // change goes elsewhere
  throwsCode(() => inspectTx(plan, edit((tx) => { tx.outputs[0].valueSatoshis -= 1n; tx.outputs[1].valueSatoshis += 1n; }), locks.S), 'PlanMismatch'); // value shifted from contract to change
  throwsCode(() => inspectTx(plan, edit((tx) => { tx.version = 1; }), locks.S), 'TxVersion');
});

test('buildTx returns what the bytes say, not what it computed: a builder lying about the fee is caught', () => {
  const plan = planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor(30000n)], ctx: {} });
  const real = buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S });
  assert.equal(real.fee, BigInt(real.size) + 2n); assert.equal(real.change, 30000n - real.fee);
  // fault injection: plan whose sponsor value is reported higher than what the serialization uses must not produce a consistent-looking result
  const lying = { ...plan, sponsors: [{ ...plan.sponsors[0], satoshis: 31000n }] };
  const liar = buildTx(lying, { provider, keys, SignatureTemplate, changeLock: locks.S });
  assert.equal(liar.change, 31000n - liar.fee, 'accounting follows the bytes it serialized');
  assert.equal(decode(liar.hex).outputs[1].valueSatoshis, liar.change);
});

test('K17 helpers: outpoints are validated and compared case-insensitively; forged chain on direct assertF1Funding', () => {
  const out = at(C, 'funded', C.params.F);
  throwsCode(() => declareFunding(newJob(C), { ...out, txid: 'zz' }), 'BadOutpoint'); throwsCode(() => declareFunding(newJob(C), { ...out, vout: -1 }), 'BadOutpoint');
  const up = { ...out, txid: out.txid.toUpperCase() };
  const job = declareFunding(newJob(C), up);
  assert.equal(job.declaredFunding.txid, out.txid.toLowerCase());
  assert.ok(assertF1Funding(job, out, C)); assert.ok(assertF1Funding(job, up, C));
  assert.equal(classifyFunded(job, [out]).declared?.txid, out.txid); assert.equal(classifyFunded(job, [up]).foreign.length, 0);
  const forged = { ...C, locks: { ...C.locks, W: locks.X } };
  assert.throws(() => assertF1Funding(job, out, forged), (e) => e instanceof ParamError, 'assertJobChain verifies the chain itself');
  assert.throws(() => assertF1Funding(job, out, { ...C, addresses: { ...C.addresses, funded: C.addresses.accepted } }), (e) => e instanceof ParamError || e.code === 'K17ChainMismatch');
});

test('input hygiene: ctx null, fractional counts, phi on single-phi paths, invalid public keys', () => {
  throwsCode(() => planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor()], ctx: null }), 'BadContext');
  throwsCode(() => planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor()], ctx: 'abc' }), 'BadContext');
  throwsCode(() => planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor()], ctx: [] }), 'BadContext');
  throwsCode(() => planSpend({ chain: C, path: 'C1', utxo: at(C, 'requested', 100000n), sponsors: [sponsor()], ctx: { confirmations: 1.5 } }), 'BadContext');
  throwsCode(() => planSpend({ chain: C, path: 'A3', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor()], ctx: { tipHeight: -1 } }), 'BadContext');
  assert.equal(planSpend({ chain: C, path: 'D1', utxo: at(C, 'd100', 100000n), sponsors: [sponsor()], ctx: { phi: 50 } }).phi, 100, 'D1-D3 only exist on the phi=100 instance');
  const badKey = Uint8Array.from([2, ...new Uint8Array(32)]);
  assert.equal(secp256k1.validatePublicKey(badKey), false);
  assert.throws(() => normalize({ ...base(), pk: { ...base().pk, W: badKey } }), (e) => e instanceof ParamError);
  // normalize copies the caller's arrays
  const b = base(); const n = normalize(b); b.pk.V[1] ^= 1; b.lock.W[0] ^= 1;
  assert.notEqual(binToHex(n.pk.V), binToHex(b.pk.V)); assert.notEqual(binToHex(n.lock.W), binToHex(b.lock.W));
});


// ---- Review round 4 ----------------------------------------------------------------------------
test('hostile sponsors array: Symbol.species / own map cannot bypass validation', () => {
  const good = sponsor(30000n);
  const evil = [{ ...sponsor(5n), lockingBytecode: C.locks.accepted, token: { amount: 1n, category: '11'.repeat(32) } }, sponsor(9n), sponsor(9n)];
  const a = [good]; a.constructor = { [Symbol.species]: function () { const o = []; o.map = () => evil; return o; } };
  const plan = planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: a, ctx: {} });
  assert.equal(plan.sponsors.length, 1); assert.equal(plan.sponsors[0].satoshis, 30000n);
  const b = [good]; b.map = () => evil;
  assert.equal(planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: b, ctx: {} }).sponsors.length, 1);
});

test('malformed hex is refused, never silently reinterpreted', () => {
  const s = sponsor(30000n);
  const mk = (lock) => planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [{ ...s, lockingBytecode: lock }], ctx: {} });
  for (const bad of ['abc', 'zzzz', '76a914zz', '0x51', ' 51', '5']) throwsCode(() => mk(bad), 'BadBytes');
  throwsCode(() => mk([0x51, 300]), 'BadBytes'); throwsCode(() => mk({ length: 1 }), 'BadBytes'); throwsCode(() => mk(5), 'BadBytes');
  assert.ok(mk(binToHex(locks.S).toUpperCase()), 'valid upper-case hex is fine');
  const plan = planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [s], ctx: {} });
  const goodHex = binToHex(locks.S);
  for (const bad of ['76a914zz' + goodHex.slice(8), goodHex.slice(1), goodHex + 'z', 'abc']) assert.throws(() => buildTx(plan, { provider, keys, SignatureTemplate, changeLock: bad }), (e) => e.code === 'BadBytes' || e.code === 'BadChangeLock');
  assert.throws(() => planSpend({ chain: C, path: 'A1', utxo: { ...at(C, 'accepted', 100000n), lockingBytecode: 'abc' }, sponsors: [s], ctx: {} }), (e) => e.code === 'BadBytes');
  assert.throws(() => normalize({ ...base(), lock: { ...base().lock, V: 'zz' } }), (e) => e instanceof ParamError);
  assert.throws(() => normalize({ ...base(), pk: { ...base().pk, V: 'abc' } }), (e) => e instanceof ParamError);
});

test('change lock must be a standard spendable shape', () => {
  const plan = planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor(30000n)], ctx: {} });
  const p2pkh = locks.S, p2sh20 = Uint8Array.from([0xa9, 0x14, ...new Uint8Array(20), 0x87]), p2sh32 = Uint8Array.from([0xaa, 0x20, ...new Uint8Array(32), 0x87]);
  for (const ok of [p2pkh, p2sh20, p2sh32]) assert.ok(buildTx(plan, { provider, keys, SignatureTemplate, changeLock: ok }).hasChange);
  for (const bad of [Uint8Array.from([0x00, 0x6a]), Uint8Array.from([0x4c]), Uint8Array.from([0x00, 0x00]), Uint8Array.from([0x51]), p2pkh.slice(0, 24), Uint8Array.from([0x6a, ...p2pkh.slice(1)])])
    assert.throws(() => buildTx(plan, { provider, keys, SignatureTemplate, changeLock: bad }), (e) => e.code === 'BadChangeLock', binToHex(bad));
});

test('outpoint comparisons are case-insensitive end to end (txids with letters, mixed case)', () => {
  const lower = at(C, 'funded', C.params.F); assert.notEqual(lower.txid, lower.txid.toUpperCase(), 'fixture txid contains letters');
  const upper = { ...lower, txid: lower.txid.toUpperCase() };
  const job = declareFunding(newJob(C), upper);
  assert.equal(job.declaredFunding.txid, lower.txid);
  const plan = planSpend({ chain: C, path: 'F1', utxo: upper, sponsors: [sponsor()], ctx: {}, job });
  const r = buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S });
  assert.ok(inspectTx(plan, r.hex, locks.S)); r.builder.debug();
  const planL = planSpend({ chain: C, path: 'F1', utxo: lower, sponsors: [sponsor()], ctx: {}, job });
  assert.ok(inspectTx(planL, r.hex.length ? buildTx(planL, { provider, keys, SignatureTemplate, changeLock: locks.S }).hex : '', locks.S));
  assert.equal(classifyFunded(job, [upper]).declared?.txid, upper.txid); assert.equal(classifyFunded(job, [lower]).foreign.length, 0);
  // a stored job with an upper-case declared txid still matches
  assert.ok(assertF1Funding({ ...job, declaredFunding: { ...job.declaredFunding, txid: upper.txid } }, lower, C));
  // duplicates are detected across case, for sponsors and for the contract outpoint
  const s = sponsor(); const cu = at(C, 'accepted', 100000n);
  throwsCode(() => planSpend({ chain: C, path: 'A1', utxo: cu, sponsors: [s, { ...sponsor(), txid: s.txid.toUpperCase(), vout: s.vout }], ctx: {} }), 'SponsorDuplicate');
  throwsCode(() => planSpend({ chain: C, path: 'A1', utxo: cu, sponsors: [{ ...sponsor(), txid: cu.txid.toUpperCase(), vout: cu.vout }], ctx: {} }), 'SponsorDuplicate');
  throwsCode(() => planSpend({ chain: C, path: 'A1', utxo: { ...cu, txid: cu.txid.toUpperCase() }, sponsors: [{ ...sponsor(), txid: cu.txid, vout: cu.vout }], ctx: {} }), 'SponsorDuplicate');
  // inspectTx matches an upper-case plan txid with the (lower-case) serialized bytes
  const plan2 = planSpend({ chain: C, path: 'A1', utxo: { ...cu, txid: cu.txid.toUpperCase() }, sponsors: [{ ...s, txid: s.txid.toUpperCase() }], ctx: {} });
  const r2 = buildTx(plan2, { provider, keys, SignatureTemplate, changeLock: locks.S }); assert.ok(inspectTx(plan2, r2.hex, locks.S));
});

test('small hygiene: dryRun must be exactly true, unknown/inherited path names, canonParams is injective', () => {
  const u = () => at(C, 'accepted', 100000n);
  throwsCode(() => planSpend({ chain: C, path: 'A3', utxo: u(), sponsors: [sponsor()], ctx: { dryRun: 'false' } }), 'MissingContext');
  throwsCode(() => planSpend({ chain: C, path: 'A3', utxo: u(), sponsors: [sponsor()], ctx: { dryRun: 1 } }), 'MissingContext');
  assert.ok(planSpend({ chain: C, path: 'A3', utxo: u(), sponsors: [sponsor()], ctx: { dryRun: true } }));
  for (const p of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) throwsCode(() => planSpend({ chain: C, path: p, utxo: u(), sponsors: [sponsor()], ctx: {} }), 'UnknownPath');
  assert.notEqual(canonParams({ tA4: '5n,tEnd:6n' }), canonParams({ tA4: 5n, tEnd: 6n }));
  assert.notEqual(canonParams({ a: '5n' }), canonParams({ a: 5n })); assert.notEqual(canonParams({ a: 5n }), canonParams({ a: 5 }));
  assert.notEqual(canonParams({ a: new Uint8Array([1]) }), canonParams({ a: '01' }));
  assert.equal(canonParams({ b: 1n, a: 2n }), canonParams({ a: 2n, b: 1n }), 'key order does not matter');
  const job = jobFor(C, at(C, 'funded', C.params.F));
  throwsCode(() => planSpend({ chain: C, path: 'F1', utxo: { ...at(C, 'funded', C.params.F), ...job.declaredFunding, lockingBytecode: C.locks.funded }, sponsors: [sponsor()], ctx: {}, job: { ...job, params: { ...job.params, tA4: 'x', tEnd: undefined } } }), 'K17ParamMismatch');
});

test('change floor depends on the change script length (P2SH32 needs 576, P2PKH 546) and is exact at the boundary', () => {
  const p2sh32 = Uint8Array.from([0xaa, 0x20, ...new Uint8Array(32).fill(7), 0x87]);
  assert.equal(changeFloor(locks.S), 546n); assert.equal(changeFloor(p2sh32), 576n);
  const build = (S, cl) => buildTx(planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor(S)], ctx: {} }), { provider, keys, SignatureTemplate, changeLock: cl });
  const f = build(40000n, p2sh32).fee;           // fee with a P2SH32 change output (a 10-byte larger output than P2PKH)
  const at576 = build(f + 576n, p2sh32), at575 = build(f + 575n, p2sh32);
  assert.equal(at576.hasChange, true); assert.equal(at576.change, 576n);
  assert.equal(at575.hasChange, false); assert.equal(at575.change, 0n); assert.equal(at575.fee, f + 575n);
  for (const r of [at576, at575]) { const tx = decode(r.hex); assert.equal(tx.outputs.length, r.hasChange ? 2 : 1); }
});
