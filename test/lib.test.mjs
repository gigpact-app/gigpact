// G2 part 2: transaction library tests (I12 chain build/verify, K17 declared funding, sponsor/sequence/fee rules).
// Evidence level: R-VM dry-run with fake outpoints (libauth VM). Not regtest, not wallet, not mainnet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignatureTemplate, randomUtxo } from 'cashscript';
import { provider, keys, tpl, locks } from './harness.mjs';
import { buildChain, verifyChain, normalize, ParamError, DEFAULTS, lockOf } from '../src/chain.mjs';
import { PATHS, PATH_IDS, planSpend, buildTx, SEQ_NONFINAL, MAX_FEE_RATE, SpendError } from '../src/spend.mjs';
import { declareFunding, classifyFunded, assertF1Funding } from '../src/k17.mjs';
import { binToHex } from '@bitauth/libauth';

const pk = (k) => tpl(k).publicKey;
const base = () => ({ pk: { V: pk(keys.V), W: pk(keys.W), A: pk(keys.A) }, lock: { V: locks.V, W: locks.W, A: locks.A }, F: 100000n, fA: 2000n, tEnd: 800000n });
const chainOf = (p = base()) => buildChain(p, { provider });
const fake = (sats) => { const u = randomUtxo({ satoshis: sats }); return { txid: u.txid, vout: u.vout, satoshis: sats }; };
const sponsor = (sats = 20000n, extra = {}) => ({ ...fake(sats), lockingBytecode: locks.S, ...extra });

const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof SpendError && e.code === code, `expected ${code}`);
const dry = (plan, feeRateOverride) => { const r = buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S }); r.builder.debug(); return r; };
const C = chainOf();

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
  // claims where one level was built from a different parameter set
  const other = chainOf({ ...base(), dv: 433n });
  const mix = (k) => ({ ...C.addresses, [k]: other.addresses[k] });
  for (const k of ['funded', 'accepted', 'requested']) assert.deepEqual(verifyChain(base(), mix(k), { provider }).mismatches, [k]);
  // Dispute instances differ by phi only (and share all other parameters): swapping them is detected
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
  bad((p) => { p.dv = 0n; }, 'dv zero');
  assert.equal(normalize(base()).tA4, 800000n + DEFAULTS.G, 'T_A4 = T_end + G (7 days = 1008 blocks)');
  assert.throws(() => buildChain(base(), {}), ParamError, 'provider required');
});

// ---- all 16 paths: plan shape + VM dry-run -------------------------------------------------
for (const id of PATH_IDS) for (const phi of (['D4', 'D5', 'D6'].includes(id) ? [100, 50] : [100])) {
  test(`${id}${['D4', 'D5', 'D6'].includes(id) ? ` (phi=${phi})` : ''}: plan shape and VM dry-run`, () => {
    const P = PATHS[id];
    const F = P.c.startsWith('d') && id === 'D3' ? 100001n : 100000n; // odd net on D3 exercises rounding
    const ck = P.c.includes('|') ? (phi === 100 ? 'd100' : 'd50') : P.c;
    const sp = [sponsor(30000n)];
    const u0 = fake(id === 'F1' ? C.params.F : F);
    const plan = planSpend({ chain: C, path: id, utxo: u0, sponsors: sp, feeRate: 1, ctx: { phi, dryRun: true }, job: id === 'F1' ? declareFunding({ params: C.params, addresses: C.addresses }, u0) : undefined });
    assert.equal(plan.contractKey, ck);
    assert.equal(plan.sponsors.every((s) => s.sequence === SEQ_NONFINAL), true, 'sponsor nSequence = 0xfffffffe (G6)');
    assert.equal(plan.input0.sequence, P.csv ? Number(C.params[P.csv]) : SEQ_NONFINAL);
    assert.equal(plan.locktime, P.cltv ? Number(C.params[P.cltv]) : 0);
    assert.equal(plan.outs.reduce((s, o) => s + o.amount, 0n), plan.input0.satoshis, 'conservation: contract outputs == input 0');
    assert.ok(plan.outs.every((o) => o.amount >= C.params.dust), 'every contract output >= DUST_SAFE');
    const r = dry(plan);
    const size = BigInt(r.size);
    assert.ok(r.fee >= size && r.fee <= size + 8n, 'fee matches size at 1 sat/byte (small safety margin)');
    assert.ok(r.change >= 0n && r.change + r.fee === 30000n, 'change + fee == sponsor total (fee and change come only from sponsor)');
    assert.equal(r.builder.inputs.length >= 2 && r.builder.inputs.length <= 3, true);
  });
}

test('graph walk: every transition output lock equals the next contract lock, and each next state spends in the VM', () => {
  const next = { F1: 'accepted', A3: 'requested', A4: 'd50', C2: 'd100' };
  const outgoing = { funded: ['F1', 'F2'], accepted: ['A1', 'A2', 'A3', 'A4'], requested: ['C1', 'C2', 'C3', 'C4'], d100: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'], d50: ['D4', 'D5', 'D6'] };
  const seen = new Set();
  const walk = (state, utxo, job) => {
    for (const id of outgoing[state]) {
      const phi = state === 'd50' ? 50 : 100;
      const plan = planSpend({ chain: C, path: id, utxo, sponsors: [sponsor(30000n)], ctx: { phi, dryRun: true }, job });
      dry(plan); seen.add(id);
      if (next[id]) {
        assert.equal(binToHex(plan.outs[0].lock), binToHex(C.locks[next[id]]), `${id} output 0 must be the ${next[id]} contract lock`);
        walk(next[id], { ...fake(plan.outs[0].amount), lockingBytecode: plan.outs[0].lock }, undefined);
      } else for (const o of plan.outs) assert.ok([locks.V, locks.W, locks.A].some((l) => binToHex(l) === binToHex(o.lock)), `${id} final outputs go only to lockV/lockW/lockA`);
    }
  };
  const f0 = fake(C.params.F);
  walk('funded', f0, declareFunding({ params: C.params, addresses: C.addresses }, f0));
  assert.deepEqual([...seen].sort(), [...PATH_IDS].sort(), 'all 16 paths executed through the state graph');
});

test('I12 failure mode: a Funded built with a wrong Accepted lock cannot be unlocked by the honest Accepted contract', () => {
  const evil = chainOf({ ...base(), dv: 433n }); // different parameters, so its Accepted lock differs
  const wrongLock = evil.locks.accepted; // what an evil Funded would pay to
  assert.notEqual(binToHex(wrongLock), binToHex(C.locks.accepted));
  const plan = planSpend({ chain: C, path: 'A3', utxo: fake(100000n), sponsors: [sponsor(30000n)], ctx: { dryRun: true } });
  plan.input0 = { ...plan.input0, lockingBytecode: wrongLock }; // the UTXO sits at the evil lock, honest unlocker
  assert.throws(() => dry(plan), 'funds at a mismatched lock are stuck; verifyChain must run BEFORE funding');
});

// ---- guards ---------------------------------------------------------------------------------
test('timing guards (library refuses transactions the node would not accept yet)', () => {
  const mk = (id, ctx) => planSpend({ chain: C, path: id, utxo: fake(100000n), sponsors: [sponsor()], ctx });
  throwsCode(() => mk('A3', { tipHeight: 799999 }), 'TooEarly'); assert.ok(mk('A3', { tipHeight: 800000 }));
  throwsCode(() => mk('A4', { tipHeight: 800000 + 1007 }), 'TooEarly'); assert.ok(mk('A4', { tipHeight: 800000 + 1008 }));
  throwsCode(() => mk('C1', { confirmations: 431 }), 'TooEarly'); assert.ok(mk('C1', { confirmations: 432 }));
  throwsCode(() => mk('D4', { confirmations: 2015, phi: 100 }), 'TooEarly'); assert.ok(mk('D4', { confirmations: 2016, phi: 50 }));
  throwsCode(() => mk('A3', {}), 'MissingContext'); throwsCode(() => mk('C1', {}), 'MissingContext');
  assert.ok(mk('A1', {}), 'non-timed paths need no context');
});

test('sponsor, fee and output guards', () => {
  const mk = (o = {}) => planSpend({ chain: C, path: 'A1', utxo: fake(100000n), sponsors: [sponsor()], ctx: {}, ...o });
  throwsCode(() => mk({ sponsors: [] }), 'SponsorCount');
  throwsCode(() => mk({ sponsors: [sponsor(), sponsor(), sponsor()] }), 'SponsorCount');
  assert.ok(mk({ sponsors: [sponsor(), sponsor()] }));
  throwsCode(() => mk({ sponsors: [sponsor(20000n, { token: { amount: 1n, category: '00'.repeat(32) } })] }), 'SponsorToken');
  throwsCode(() => mk({ feeRate: 0 }), 'FeeRate'); throwsCode(() => mk({ feeRate: MAX_FEE_RATE + 0.5 }), 'FeeRate');
  assert.ok(mk({ feeRate: MAX_FEE_RATE }));
  throwsCode(() => planSpend({ chain: C, path: 'D1', utxo: fake(C.params.fA + C.params.dust - 1n), sponsors: [sponsor()], ctx: { dryRun: true } }), 'DustOutput');
  throwsCode(() => planSpend({ chain: C, path: 'Z9', utxo: fake(1n), sponsors: [sponsor()] }), 'UnknownPath');
  throwsCode(() => planSpend({ chain: C, path: 'D4', utxo: fake(100000n), sponsors: [sponsor()], ctx: { phi: 75, dryRun: true } }), 'BadPhi');
  assert.throws(() => buildTx(mk(), { provider, keys, SignatureTemplate }), (e) => e.code === 'NoChangeLock');
  // sponsor total too small for fee: no change output, fee would eat the rest; the library must not build a negative change
  const tiny = mk({ sponsors: [sponsor(150n)] });
  assert.throws(() => buildTx(tiny, { provider, keys, SignatureTemplate, changeLock: locks.S }), 'insufficient sponsor funds');
});

// ---- K17 ------------------------------------------------------------------------------------
test('K17: declared funding outpoint rule', () => {
  const job0 = { params: C.params, addresses: C.addresses };
  const out = fake(C.params.F);
  throwsCode(() => declareFunding(job0, fake(C.params.F - 1n)), 'K17Value');
  throwsCode(() => declareFunding(job0, fake(C.params.F + 1n)), 'K17Value');
  const job = declareFunding(job0, out);
  throwsCode(() => declareFunding(job, fake(C.params.F)), 'K17AlreadyDeclared');
  assert.ok(assertF1Funding(job, out));
  throwsCode(() => assertF1Funding(job0, out), 'K17NotDeclared');
  throwsCode(() => assertF1Funding(job, { ...out, txid: '00'.repeat(32) }), 'K17Mismatch');   // wrong txid
  throwsCode(() => assertF1Funding(job, { ...out, vout: out.vout + 1 }), 'K17Mismatch');        // wrong vout
  throwsCode(() => assertF1Funding(job, { ...out, satoshis: out.satoshis + 1n }), 'K17Value'); // value drift
  throwsCode(() => assertF1Funding(job, { ...out, satoshis: out.satoshis - 1n }), 'K17Value');
  // third party sends exactly F to the same address from another outpoint: it is foreign, F1 refuses it
  const third = fake(C.params.F);
  throwsCode(() => assertF1Funding(job, third), 'K17Mismatch');
  const cls = classifyFunded(job, [out, third, fake(546n)]);
  assert.equal(cls.declared.txid, out.txid); assert.equal(cls.foreign.length, 2); assert.equal(cls.declaredMissing, false);
  assert.equal(classifyFunded(job, [third]).declaredMissing, true, 'declared outpoint already spent');
  assert.equal(classifyFunded(job0, [out]).undeclared, true, 'no declaration: nothing counts as funding');
  // F1 builds only for the declared outpoint, through planSpend
  const ok = planSpend({ chain: C, path: 'F1', utxo: out, sponsors: [sponsor()], ctx: {}, job }); dry(ok);
  throwsCode(() => planSpend({ chain: C, path: 'F1', utxo: third, sponsors: [sponsor()], ctx: {}, job }), 'K17Mismatch');
  throwsCode(() => planSpend({ chain: C, path: 'F1', utxo: out, sponsors: [sponsor()], ctx: {} }), 'K17NotDeclared');
  // F2 (cancel) can still refund a foreign or sub-dust UTXO to the employer (G1-01)
  for (const sats of [546n, 999n, 100000n, 250000n]) dry(planSpend({ chain: C, path: 'F2', utxo: fake(sats), sponsors: [sponsor()], ctx: {} }));
});
