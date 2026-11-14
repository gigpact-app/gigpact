// G2: 16-path R-VM battery. Evidence level: R-VM (libauth VM). Not regtest, not wallet, not mainnet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chain, run, keys, tpl, locks, lockOf, P, SH, lineIn, results } from './harness.mjs';
import { randomToken } from 'cashscript';

const C = chain();
const Fa = P.Fa, fA = P.fA, D = P.dust;
const net = (F) => F - fA, W = (F) => net(F) / 2n;
const roles = ['V', 'W', 'A', 'X'];

// id, contract name, function, signer, value, outputs, count limits, timing, dust-floor probe
const PATHS = [
  { id: 'F1', cn: 'GigPactFunded', fn: 'accept', c: C.funded, s: 'W', F: Fa, outs: (F) => [[lockOf(C.accepted), F]], max: 2 },
  { id: 'F2', cn: 'GigPactFunded', fn: 'cancel', c: C.funded, s: 'V', F: Fa, outs: (F) => [[locks.V, F]], max: 2 },
  { id: 'A1', cn: 'GigPactAccepted', fn: 'pay', c: C.accepted, s: 'V', F: Fa, outs: (F) => [[locks.W, F]], max: 2, floor: { re: /F >= dustSafe/, f: D } },
  { id: 'A2', cn: 'GigPactAccepted', fn: 'waive', c: C.accepted, s: 'W', F: Fa, outs: (F) => [[locks.V, F]], max: 2, floor: { re: /F >= dustSafe/, f: D } },
  { id: 'A3', cn: 'GigPactAccepted', fn: 'claim', c: C.accepted, s: 'W', F: Fa, outs: (F) => [[lockOf(C.requested), F]], max: 2, floor: { re: /F >= dustSafe/, f: D }, t: { k: 'locktime', v: P.tEnd, re: /tx\.time >= tEnd/ } },
  { id: 'A4', cn: 'GigPactAccepted', fn: 'openDispute', c: C.accepted, s: 'V', F: Fa, outs: (F) => [[lockOf(C.d50), F]], max: 2, floor: { re: /F >= dustSafe/, f: D }, t: { k: 'locktime', v: P.tA4, re: /tx\.time >= tA4/ } },
  { id: 'C1', cn: 'GigPactRequested', fn: 'complete', c: C.requested, s: null, F: Fa, outs: (F) => [[locks.W, F]], max: 2, floor: { re: /F >= dustSafe/, f: D }, t: { k: 'seq', v: P.dv, re: /this\.age >= dv/ } },
  { id: 'C2', cn: 'GigPactRequested', fn: 'objectClaim', c: C.requested, s: 'V', F: Fa, outs: (F) => [[lockOf(C.d100), F]], max: 2, floor: { re: /F >= dustSafe/, f: D } },
  { id: 'C3', cn: 'GigPactRequested', fn: 'payOut', c: C.requested, s: 'V', F: Fa, outs: (F) => [[locks.W, F]], max: 2, floor: { re: /F >= dustSafe/, f: D } },
  { id: 'C4', cn: 'GigPactRequested', fn: 'waive', c: C.requested, s: 'W', F: Fa, outs: (F) => [[locks.V, F]], max: 2, floor: { re: /F >= dustSafe/, f: D } },
  { id: 'D1', cn: 'GigPactDispute', fn: 'decideWorker', c: C.d100, s: 'A', F: Fa, outs: (F) => [[locks.W, F - fA], [locks.A, fA]], max: 3, floor: { re: /F - fA >= dustSafe/, f: fA + D } },
  { id: 'D2', cn: 'GigPactDispute', fn: 'decideEmployer', c: C.d100, s: 'A', F: Fa, outs: (F) => [[locks.V, F - fA], [locks.A, fA]], max: 3, floor: { re: /F - fA >= dustSafe/, f: fA + D } },
  { id: 'D3', cn: 'GigPactDispute', fn: 'decideSplit', c: C.d100, s: 'A', F: Fa, outs: (F) => [[locks.W, W(F)], [locks.V, net(F) - W(F)], [locks.A, fA]], max: 4, floor: { re: /w >= dustSafe/, f: fA + 2n * D } },
  { id: 'D4a', cn: 'GigPactDispute', fn: 'fallback', c: C.d100, s: null, F: Fa, outs: (F) => [[locks.W, F]], max: 2, t: { k: 'seq', v: P.l, re: /this\.age >= l/ }, floor: { re: /F >= dustSafe/, f: D, after: 'phi == 100' } },
  { id: 'D4b', cn: 'GigPactDispute', fn: 'fallback', c: C.d50, s: null, F: Fa, outs: (F) => [[locks.W, F / 2n], [locks.V, F - F / 2n]], max: 3, t: { k: 'seq', v: P.l, re: /this\.age >= l/ }, floor: { re: /w >= dustSafe/, f: 2n * D, after: '} else {' }, after: '} else {' },
  { id: 'D5', cn: 'GigPactDispute', fn: 'payOut', c: C.d100, s: 'V', F: Fa, outs: (F) => [[locks.W, F]], max: 2, floor: { re: /F >= dustSafe/, f: D } },
  { id: 'D6', cn: 'GigPactDispute', fn: 'waive', c: C.d100, s: 'W', F: Fa, outs: (F) => [[locks.V, F]], max: 2, floor: { re: /F >= dustSafe/, f: D } },
];

const sig = (p, who, sh) => (p.s ? [tpl(keys[who ?? p.s], sh)] : []);
function spec(p, o = {}) {
  const F = o.F ?? p.F;
  const outs = (o.outs ?? p.outs(F)).map(([to, amount, token]) => ({ to, amount, token }));
  const s = { contract: p.c, fn: p.fn, args: o.args ?? sig(p, o.who, o.sh), value: F, outs, sponsors: o.sponsors ?? [20000n], contractIdx: o.contractIdx, sponsorTokenIdx: o.sponsorTokenIdx };
  const tv = o.tv ?? p.t?.v;
  if (p.t) { if (p.t.k === 'locktime') s.locktime = tv; else s.seq = tv; }
  return s;
}
const L = (p, re, opts) => lineIn(p.cn, p.fn, re, opts);
const LO = (p, re) => lineIn(p.cn, p.fn, re, { after: p.after });
function exp(p, name, r, ok, line) {
  const good = ok ? r.ok : (!r.ok && (line === undefined || r.line === line));
  results.push({ path: p.id, case: name, expect: ok ? 'pass' : 'fail', line: line ?? null, got: r.ok ? 'pass' : 'fail', gotLine: r.line ?? null, ok: good, err: r.ok ? undefined : r.err });
  assert.ok(good, `${p.id} ${name}: expected ${ok ? 'pass' : 'fail@' + line}, got ${r.ok ? 'pass' : r.err}`);
}
const okC = (p, name, o) => exp(p, name, run(spec(p, o)), true);
const noC = (p, name, o, line) => exp(p, name, run(spec(p, o)), false, line);

for (const p of PATHS) {
  test(`${p.id} ${p.cn}.${p.fn}: valid forms`, () => {
    okC(p, 'valid, 2 inputs, exact outputs');
    okC(p, 'valid, 3 inputs (2 sponsors)', { sponsors: [20000n, 20000n] });
    if (p.outs(p.F).length < p.max) okC(p, 'valid, extra sponsor-change output', { outs: [...p.outs(p.F), [locks.S, 1000n]] });
    for (const [n, sh] of [['0x41 (no UTXOS)', SH.H41], ['0xC1 (ANYONECANPAY)', SH.HC1]]) if (p.s) okC(p, `boundary G1-02: contract accepts sighash ${n}`, { sh });
  });
  test(`${p.id}: roles and signatures`, () => {
    if (!p.s) return okC(p, 'no signature required (nobody signs)');
    const line = L(p, /checkSig/);
    for (const r of roles.filter((x) => x !== p.s)) noC(p, `wrong signer ${r}`, { who: r }, line);
  });
  test(`${p.id}: outputs`, () => {
    const base = p.outs(p.F);
    base.forEach(([, amt], k) => {
      const lk = LO(p, new RegExp(`tx\\.outputs\\[${k}\\]\\.lockingBytecode`));
      const vl = LO(p, new RegExp(`tx\\.outputs\\[${k}\\]\\.value`));
      const wrong = base.map((x) => [...x]); wrong[k][0] = locks.X;
      noC(p, `out${k} to wrong lock`, { outs: wrong }, lk);
      for (const d of [-1n, 1n]) { const v = base.map((x) => [...x]); v[k][1] = amt + d; noC(p, `out${k} value ${d > 0 ? '+' : ''}${d} sat`, { outs: v }, vl); }
    });
    const cnt = LO(p, /tx\.outputs\.length ==/);
    noC(p, `too many outputs (${p.max + 1})`, { outs: [...base, ...Array.from({ length: p.max + 1 - base.length }, () => [locks.S, 1000n])] }, cnt);
    if (base.length > 1) assert.equal(run(spec(p, { outs: base.slice(0, base.length - 1) })).ok, false, 'too few outputs');
  });
  test(`${p.id}: tokens`, () => {
    const base = p.outs(p.F);
    const tok = () => randomToken({ amount: 1n });
    const w = base.map((x) => [...x]); w[0][2] = tok();
    exp(p, 'token on out0', run(spec(p, { outs: w })), false);
    exp(p, 'token on extra output', run(spec(p, { outs: [...base, [locks.S, 1000n, tok()]] })), false);
    const k = base.length; // extra output index
    if (k < p.max) {
      const r = run(spec(p, { outs: [...base, [locks.S, 1000n, tok()]] }));
      assert.equal(r.ok, false);
    }
    noC(p, 'token on input1', { sponsorTokenIdx: 0 }, L(p, /tx\.inputs\[1\]\.tokenCategory/));
    noC(p, 'token on input2 (3 inputs)', { sponsors: [20000n, 20000n], sponsorTokenIdx: 1 }, L(p, /tx\.inputs\[2\]\.tokenCategory/));
  });
  test(`${p.id}: input shape`, () => {
    noC(p, 'single input (no sponsor)', { sponsors: [], outs: p.outs(p.F).map(([t, a], k) => [t, k === 0 ? a - 3000n : a]) }, L(p, /inputs\.length >= 2/));
    noC(p, 'four inputs', { sponsors: [20000n, 20000n, 20000n] }, L(p, /inputs\.length <= 3/));
    noC(p, 'contract at input index 1', { contractIdx: 1 }, L(p, /activeInputIndex == 0/));
  });
  if (p.floor) test(`${p.id}: value floor`, () => {
    const f = p.floor, line = lineIn(p.cn, p.fn, f.re, { after: f.after ?? p.after });
    noC(p, `value ${f.f - 1n} below floor`, { F: f.f - 1n }, line);
    okC(p, `value ${f.f} at floor`, { F: f.f });
  });
  if (p.t) test(`${p.id}: timelock boundary`, () => {
    const line = L(p, p.t.re);
    noC(p, `lock ${p.t.v - 1n} too early`, { tv: p.t.v - 1n }, line);
    okC(p, `lock ${p.t.v} exactly`, { tv: p.t.v });
    okC(p, `lock ${p.t.v + 1n} later`, { tv: p.t.v + 1n });
  });
}

// ---- path-specific cases ----
const P_ = Object.fromEntries(PATHS.map((p) => [p.id, p]));

test('F1 exact funding bounds', () => {
  const p = P_.F1, line = L(p, /F == fundedValue/);
  noC(p, 'F = Fa - 1', { F: Fa - 1n, outs: [[lockOf(C.accepted), Fa - 1n]] }, line);
  noC(p, 'F = Fa + 1', { F: Fa + 1n, outs: [[lockOf(C.accepted), Fa + 1n]] }, line);
  noC(p, 'F = 0.5 Fa (partial)', { F: Fa / 2n, outs: [[lockOf(C.accepted), Fa / 2n]] }, line);
});
test('F2 refund of any amount (G1-01)', () => {
  const p = P_.F2;
  for (const F of [546n, 999n, 1000n, Fa - 1n, Fa, Fa + 1n, 3n * Fa]) okC(p, `F2 refund F=${F}`, { F, outs: [[locks.V, F]] });
  noC(p, 'F2 refund to W', { outs: [[locks.W, Fa]] }, L(p, /tx\.outputs\[0\]\.lockingBytecode/));
});
test('F1 fixed-parameter limits (9.2/9.3) via constructor', () => {
  const cases = [
    ['fA below DUST_SAFE', { fA: D - 1n }, /fA >= dustSafe/],
    ['4*fA above Fa', { fA: 25001n }, /fA \+ fA \+ fA \+ fA <= fundedValue/],
    ['Fa - fA < 2*dust attempt (implied: trips the 4*fA line first)', { Fa: 4000n, fA: 1001n }, /fA \+ fA \+ fA \+ fA <= fundedValue/],
    ['Fa/2 < dust attempt (implied: trips the 4*fA line first)', { Fa: 1999n, fA: 1000n }, /fA \+ fA \+ fA \+ fA <= fundedValue/],
  ];
  for (const [n, over, re] of cases) {
    const c = chain(over), p = { ...P_.F1, c: c.funded, F: c.p.Fa, outs: (F) => [[lockOf(c.accepted), F]] };
    noC(p, n, {}, L(P_.F1, re));
  }
  const c = chain({ Fa: 8000n, fA: 2000n }), p = { ...P_.F1, c: c.funded, F: 8000n, outs: (F) => [[lockOf(c.accepted), F]] };
  okC(p, 'boundary: 4*fA == Fa, Fa-fA = 6000, Fa/2 = 4000 passes', {});
});
test('D1/D2 fee split and fA constraint', () => {
  for (const id of ['D1', 'D2']) {
    const p = P_[id];
    const c = chain({ fA: D - 1n }), q = { ...p, c: c.d100, outs: (F) => [[id === 'D1' ? locks.W : locks.V, F - (D - 1n)], [locks.A, D - 1n]] };
    noC(q, `${id}: fA below dust`, {}, L(p, /fA >= dustSafe/));
    noC(p, `${id}: arbiter fee fA+1 to arbiter`, { outs: [[p.outs(p.F)[0][0], p.F - fA - 1n], [locks.A, fA + 1n]] }, L(p, /tx\.outputs\[0\]\.value/));
  }
});
test('D3 rounding (floor to worker, remainder to employer)', () => {
  const p = P_.D3;
  for (const F of [fA + 2n * D, fA + 2n * D + 1n, fA + 2n * D + 7n, Fa, Fa + 1n]) okC(p, `D3 F=${F} net=${net(F)} w=${W(F)}`, { F });
  const F = Fa + 1n; // odd net
  noC(p, 'odd net: swapped halves (w ceil, v floor)', { F, outs: [[locks.W, net(F) - W(F)], [locks.V, W(F)], [locks.A, fA]] }, L(p, /tx\.outputs\[0\]\.value/));
  noC(p, 'odd net: 1 sat dropped from v', { F, outs: [[locks.W, W(F)], [locks.V, net(F) - W(F) - 1n], [locks.A, fA]] }, L(p, /tx\.outputs\[1\]\.value/));
});
test('D4 fallback, phi = 100 / 50 / invalid', () => {
  okC(P_.D4a, 'phi=100: all to W');
  for (const F of [Fa, Fa + 1n, 2n * D, 2n * D + 1n]) okC(P_.D4b, `phi=50 F=${F}: floor to W, rest to V`, { F });
  const F = Fa + 1n;
  noC(P_.D4b, 'phi=50 odd F: swapped halves', { F, outs: [[locks.W, F - F / 2n], [locks.V, F / 2n]] }, lineIn('GigPactDispute', 'fallback', /tx\.outputs\[0\]\.value/, { after: '} else {' }));
  noC(P_.D4a, 'phi=100 instance with 50/50 outputs', { outs: [[locks.W, Fa / 2n], [locks.V, Fa / 2n]] }, L(P_.D4a, /tx\.outputs\[0\]\.value/));
  noC(P_.D4b, 'phi=50 instance with full-to-W output', { outs: [[locks.W, Fa]] }, lineIn('GigPactDispute', 'fallback', /tx\.outputs\[0\]\.value/, { after: '} else {' }));
  for (const bad of [0n, 1n, 51n, 75n, 99n, 101n, -50n]) {
    const d = C.dispute(bad), p = { ...P_.D4a, c: d };
    noC(p, `invalid phi=${bad}`, {}, lineIn('GigPactDispute', 'fallback', /phi == 100 \|\| phi == 50/));
  }
});
test('D4 / C1 relative lock: sequence flags', () => {
  // this.age needs a block-height relative lock (type bit 22 clear); a time-type lock must not satisfy it
  for (const id of ['C1', 'D4a']) {
    const p = P_[id], line = L(p, p.t.re);
    noC(p, 'seq 0 (no relative lock)', { tv: 0n }, line);
    noC(p, 'seq 0xffffffff (disabled)', { tv: 0xffffffffn }, undefined);
  }
});
test('I12: constructor-parameter mismatch is not caught by the contract (boundary G1-03)', () => {
  const evil = chain({ acc: C.d100 }); // Funded points at the wrong "Accepted" lock
  const p = { ...P_.F1, c: evil.funded, outs: (F) => [[lockOf(C.accepted), F]] };
  noC(p, 'honest Accepted lock rejected when Funded was built wrong', {}, L(P_.F1, /tx\.outputs\[0\]\.lockingBytecode/));
  const q = { ...P_.F1, c: evil.funded, outs: (F) => [[lockOf(C.d100), F]] };
  okC(q, 'BOUNDARY: contract accepts whatever lock it was built with; tx library (I12) must verify the chain');
});
test('Races: conflicting spends of one UTXO are each valid in R-VM (conflict is consensus-level, needs regtest G3)', () => {
  const both = (a, b, name) => { okC(P_[a], `${name}: ${a} valid`); okC(P_[b], `${name}: ${b} valid`); };
  both('C1', 'C2', 'Requested at age>=Dv: complete vs object');
  both('A2', 'A3', 'Accepted after T_end: waive vs claim');
  both('A1', 'A4', 'Accepted after T_A4: pay vs openDispute');
  both('D1', 'D2', 'Dispute: decideWorker vs decideEmployer');
  both('D4a', 'D5', 'Dispute after L: fallback vs pay');
});
