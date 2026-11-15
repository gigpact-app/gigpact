// G2 part 2: transaction library tests (I12 chain build/verify, K17 declared funding, sponsor/sequence/fee rules).
// Evidence level: R-VM dry-run with synthetic (fake) outpoints in the libauth VM. Not regtest, not wallet, not mainnet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignatureTemplate, randomUtxo, randomToken } from 'cashscript';
import { provider, keys, tpl, locks, VM_TARGET } from './harness.mjs';
import { buildChain, verifyChain, normalize, ParamError, DEFAULTS, BIP68_MAX_BLOCKS } from '../src/chain.mjs';
import { PATHS, PATH_IDS, planSpend, buildTx, inspectTx, csvSequence, SEQ_NONFINAL, MAX_FEE_RATE, MIN_OUTPUT, SpendError } from '../src/spend.mjs';
import { declareFunding, classifyFunded, assertF1Funding, newJob } from '../src/k17.mjs';
import { binToHex, hexToBin, decodeTransactionBch, createVirtualMachineBch2025, createVirtualMachineBch2026 } from '@bitauth/libauth';

const pk = (k) => tpl(k).publicKey;
const base = () => ({ pk: { V: pk(keys.V), W: pk(keys.W), A: pk(keys.A) }, lock: { V: locks.V, W: locks.W, A: locks.A }, F: 100000n, fA: 2000n, tEnd: 800000n });
const chainOf = (p = base()) => buildChain(p, { provider });
const fake = (sats) => { const u = randomUtxo({ satoshis: sats }); return { txid: u.txid, vout: u.vout, satoshis: sats }; };
// a synthetic contract UTXO that really sits at the given state's lock (explicit lockingBytecode, as the library now requires)
const at = (chain, key, sats) => ({ ...fake(sats), lockingBytecode: chain.locks[key] });
const sponsor = (sats = 20000n, extra = {}) => ({ ...fake(sats), lockingBytecode: locks.S, ...extra });
const jobFor = (chain, utxo) => declareFunding(newJob(chain), utxo);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof SpendError && e.code === code, `expected ${code}`);
const dry = (plan) => { const r = buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S }); r.builder.debug(); return r; };
const C = chainOf();
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
    const P = PATHS[id];
    const ck = P.c.includes('|') ? (phi === 100 ? 'd100' : 'd50') : P.c;
    const u0 = at(C, ck, id === 'F1' ? C.params.F : id === 'D3' ? 100001n : 100000n); // odd net on D3 exercises rounding
    const plan = planSpend({ chain: C, path: id, utxo: u0, sponsors: [sponsor(30000n)], feeRate: 1, ctx: { phi, dryRun: true }, job: id === 'F1' ? jobFor(C, u0) : undefined });
    assert.equal(plan.contractKey, ck);
    assert.equal(binToHex(plan.input0.lockingBytecode), binToHex(C.locks[ck]), 'input 0 carries the supplied actual lock');
    assert.equal(plan.sponsors.every((s) => s.sequence === SEQ_NONFINAL), true, 'sponsor nSequence = 0xfffffffe (G6)');
    assert.equal(plan.input0.sequence, P.csv ? Number(C.params[P.csv]) : SEQ_NONFINAL);
    assert.equal(plan.locktime, P.cltv ? Number(C.params[P.cltv]) : 0);
    assert.equal(plan.outs.reduce((s, o) => s + o.amount, 0n), plan.input0.satoshis, 'conservation: contract outputs == input 0');
    assert.ok(plan.outs.every((o) => o.amount >= C.params.dust), 'every contract output >= DUST_SAFE');
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

test('sponsor, fee-rate and output guards', () => {
  const mk = (o = {}) => planSpend({ chain: C, path: 'A1', utxo: at(C, 'accepted', 100000n), sponsors: [sponsor()], ctx: {}, ...o });
  throwsCode(() => mk({ sponsors: [] }), 'SponsorCount');
  throwsCode(() => mk({ sponsors: [sponsor(), sponsor(), sponsor()] }), 'SponsorCount');
  assert.ok(mk({ sponsors: [sponsor(), sponsor()] }));
  throwsCode(() => mk({ sponsors: [sponsor(20000n, { token: { amount: 1n, category: '00'.repeat(32) } })] }), 'SponsorToken');
  throwsCode(() => mk({ feeRate: 0 }), 'FeeRate'); throwsCode(() => mk({ feeRate: MAX_FEE_RATE + 0.5 }), 'FeeRate');
  assert.ok(mk({ feeRate: MAX_FEE_RATE }));
  throwsCode(() => planSpend({ chain: C, path: 'D1', utxo: at(C, 'd100', C.params.fA + C.params.dust - 1n), sponsors: [sponsor()], ctx: { dryRun: true } }), 'DustOutput');
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
