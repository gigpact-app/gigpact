// G3-b: negative paths + dust/relay measurements on a REAL local BCHN regtest node.
// Evidence level: REGTEST (real node consensus + mempool policy; local; no wallet; no mainnet).
// Every rejection asserts the node's reason string (not just "failed"), so a reject for the wrong reason cannot pass.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { encodeTransaction, binToHex, lockingBytecodeToCashAddress, encodeLockingBytecodeP2sh32, sha256 } from '@bitauth/libauth';
import { provider, keys, tpl, locks } from '../harness.mjs';
import { buildChain } from '../../src/chain.mjs';
import { planSpend, buildTx, toBuilder } from '../../src/spend.mjs';
import { declareFunding, newJob } from '../../src/k17.mjs';
import { startNode, stopNode, rpc, mine, coinbaseOf, send, height } from './node.mjs';

const pk = (k) => tpl(k).publicKey;
const TEND = 300n, F = 100000n;
const params = { pk: { V: pk(keys.V), W: pk(keys.W), A: pk(keys.A) }, lock: { V: locks.V, W: locks.W, A: locks.A }, F, fA: 2000n, tEnd: TEND };
const chain = buildChain(params, { provider });
const rec = []; const note = (name, ok, detail = {}) => rec.push({ name, ok, level: 'regtest', ...detail });
const hexOf = (b) => binToHex(Uint8Array.from(b));
const addr = (lb) => lockingBytecodeToCashAddress({ bytecode: lb, prefix: 'bchtest' }).address;
let nodeInfo; const st = {};

before(async () => { nodeInfo = await startNode(); nodeInfo.subversion = (await rpc('getnetworkinfo')).subversion; });
after(async () => {
  writeFileSync(new URL('../results-regtest-g3b.json', import.meta.url), JSON.stringify({ level: 'regtest', node: nodeInfo?.subversion, cases: rec }, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
  await stopNode();
});

async function outOf(txid, lockHex, n = 0) {
  const t = await rpc('getrawtransaction', [txid, true]);
  const i = t.vout.findIndex((o, k) => o.scriptPubKey.hex === lockHex && k >= n);
  assert.ok(i >= 0, 'output not found');
  return { txid, vout: i, satoshis: BigInt(Math.round(t.vout[i].value * 1e8)) };
}
const sponsorUtxo = (u) => ({ ...u, lockingBytecode: locks.S });
const confs = async (txid) => (await rpc('getrawtransaction', [txid, true])).confirmations;
const mk = (args) => { const plan = planSpend({ chain, ...args }); const r = buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S }); return { plan, ...r }; };
// same plan, but tampered (outs / sequence / signer key) and re-serialized with the same fee
const tamper = (good, patch, k = keys) => toBuilder({ ...good.plan, ...patch }, { provider, keys: k, SignatureTemplate, changeLock: locks.S, fee: good.fee }).build();
const expectReject = async (name, hex, re) => {
  const r = await send(hex);
  const ok = r.ok === false && re.test(r.error);
  note(name, ok, { error: r.error ?? 'ACCEPTED' });
  assert.equal(r.ok, false, `${name}: node accepted a tx that must be rejected`);
  assert.match(r.error, re, `${name}: rejected for the wrong reason`);
};

// pools: V employer coin chain, sponsor coin chain (each spend's change feeds the next)
async function fund() {
  const b = new TransactionBuilder({ provider });
  b.addInput({ ...st.v, lockingBytecode: hexOf(locks.V) }, tpl(keys.V).unlockP2PKH());
  b.addOutput({ to: addr(chain.locks.funded), amount: F });
  b.addOutput({ to: addr(locks.V), amount: st.v.satoshis - F - 1000n });
  const r = await send(b.build()); assert.ok(r.ok, JSON.stringify(r));
  const f = await outOf(r.result, hexOf(chain.locks.funded)); st.v = await outOf(r.result, hexOf(locks.V));
  return { ...f, lockingBytecode: Uint8Array.from(chain.locks.funded) };
}
async function spon() { // fresh sponsor coin: pay S from the S coinbase chain
  const b = new TransactionBuilder({ provider });
  b.addInput({ ...st.s, lockingBytecode: hexOf(locks.S) }, tpl(keys.S).unlockP2PKH());
  b.addOutput({ to: addr(locks.S), amount: 50000n });
  b.addOutput({ to: addr(locks.S), amount: st.s.satoshis - 50000n - 1000n });
  const r = await send(b.build()); assert.ok(r.ok, JSON.stringify(r));
  const a = await outOf(r.result, hexOf(locks.S), 0); st.s = await outOf(r.result, hexOf(locks.S), 1);
  return sponsorUtxo(a);
}

test('setup: coinbases, tip = tEnd', async () => {
  const hV = await mine(1, locks.V); const hS = await mine(1, locks.S); await mine(100, locks.X);
  const cv = await coinbaseOf(hV[0]), cs = await coinbaseOf(hS[0]); st.v = cv; st.s = cs;
  await mine(Number(TEND) - (await height()), locks.X);
  assert.equal(await height(), Number(TEND));
  note('setup', true, { subversion: nodeInfo.subversion });
});

test('F1 negatives: wrong signer, wrong lock, wrong amount', async () => {
  let u = await fund(); let sp = await spon();
  const good = () => mk({ utxo: u, path: 'F1', sponsors: [sp], ctx: {}, job: declareFunding(newJob(chain), u) });
  const g = good();
  await expectReject('F1 signed by X instead of W', tamper(g, {}, { ...keys, W: keys.X }), /CHECK\(MULTI\)SIG/);
  await expectReject('F1 output to V instead of Accepted lock', tamper(g, { outs: [{ ...g.plan.outs[0], lock: locks.V }] }), /OP_EQUALVERIFY/);
  await expectReject('F1 output F-1 instead of F', tamper(g, { outs: [{ ...g.plan.outs[0], amount: F - 1n }] }), /OP_NUMEQUALVERIFY/);
  const r = await send(g.hex); assert.ok(r.ok, JSON.stringify(r)); note('F1 control (unmodified) accepted', true, { txid: r.result });
  await mine(1, locks.X);
  await expectReject('F1 replay after confirmation', g.hex, /already in block chain/);
  st.f1 = r.result;
});

test('F2 negative: cancel signed by W instead of V', async () => {
  const u = await fund(); const sp = await spon();
  const g = mk({ utxo: u, path: 'F2', sponsors: [sp], ctx: {} });
  await expectReject('F2 signed by W instead of V', tamper(g, {}, { ...keys, V: keys.W }), /CHECK\(MULTI\)SIG/);
  const r = await send(g.hex); assert.ok(r.ok, JSON.stringify(r)); note('F2 control accepted', true, { txid: r.result });
  await mine(1, locks.X);
});

test('A3 / C1 negatives: final sequence on the contract input, sequence below dv', async () => {
  const u = await fund(); const sp = await spon();
  const f1 = mk({ utxo: u, path: 'F1', sponsors: [sp], ctx: {}, job: declareFunding(newJob(chain), u) });
  const rf = await send(f1.hex); assert.ok(rf.ok, JSON.stringify(rf));
  const acc = { ...(await outOf(rf.result, hexOf(chain.locks.accepted))), lockingBytecode: Uint8Array.from(chain.locks.accepted) };
  const sp2 = sponsorUtxo(await outOf(rf.result, hexOf(locks.S)));
  await mine(1, locks.X);
  const a3 = mk({ utxo: acc, path: 'A3', sponsors: [sp2], ctx: { tipHeight: Number(await height()) } });
  await expectReject('A3 contract input nSequence 0xffffffff (CLTV needs non-final)', tamper(a3, { input0: { ...a3.plan.input0, sequence: 0xffffffff } }), /Locktime requirement not satisfied/);
  const ra = await send(a3.hex); assert.ok(ra.ok, JSON.stringify(ra)); note('A3 control accepted', true, { txid: ra.result });
  const req = { ...(await outOf(ra.result, hexOf(chain.locks.requested))), lockingBytecode: Uint8Array.from(chain.locks.requested) };
  const sp3 = sponsorUtxo(await outOf(ra.result, hexOf(locks.S)));
  await mine(1, locks.X); await mine(431, locks.X); assert.equal(await confs(ra.result), 432);
  const c1 = mk({ utxo: req, path: 'C1', sponsors: [sp3], ctx: { confirmations: 432 } });
  await expectReject('C1 nSequence 431 < dv at 432 confirmations', tamper(c1, { input0: { ...c1.plan.input0, sequence: 431 } }), /Locktime requirement not satisfied/);
  const rc = await send(c1.hex); assert.ok(rc.ok, JSON.stringify(rc)); note('C1 control accepted', true, { txid: rc.result });
  await mine(1, locks.X);
});

test('dust / relay measurement on the node (plain outputs, no contract)', async () => {
  const p2sh32 = (n) => encodeLockingBytecodeP2sh32(sha256.hash(Uint8Array.of(n)));
  const out = {};
  for (const [label, lock] of [['P2PKH', locks.X], ['P2SH32', p2sh32(1)]]) {
    out[label] = {};
    for (const amt of [545n, 546n, 575n, 576n, 1000n]) {
      const b = new TransactionBuilder({ provider });
      b.addInput({ ...st.v, lockingBytecode: hexOf(locks.V) }, tpl(keys.V).unlockP2PKH());
      b.addOutput({ to: addr(lock), amount: 1000n });
      b.addOutput({ to: addr(locks.V), amount: st.v.satoshis - amt - 1000n });
      b.outputs[0].amount = amt; // below the SDK floor on purpose: we measure the NODE's policy, signatures are made at build time
      const r = await send(binToHex(encodeTransaction(b.buildLibauthTransaction(true)))); out[label][amt.toString()] = r.ok ? 'accepted' : r.error;
      if (r.ok) { st.v = await outOf(r.result, hexOf(locks.V), 1); }
    }
  }
  note('dust threshold by output type (node policy)', true, { out });
  assert.match(out.P2PKH['545'], /dust/); assert.match(out.P2SH32['575'], /dust/); assert.match(out.P2SH32['545'], /dust/); assert.equal(out.P2PKH['546'], 'accepted');
  assert.equal(out.P2SH32['575'] === 'accepted', false); assert.equal(out.P2SH32['576'], 'accepted');
  // relay fee: ~0.5 sat/byte rejected, >=1 sat/byte accepted
  const mkFeeTx = (fee) => { const b = new TransactionBuilder({ provider }); b.addInput({ ...st.v, lockingBytecode: hexOf(locks.V) }, tpl(keys.V).unlockP2PKH()); b.addOutput({ to: addr(locks.V), amount: st.v.satoshis - fee }); return b.buildLibauthTransaction(true); };
  const mkFee = (fee) => binToHex(encodeTransaction(mkFeeTx(fee)));
  const low = await send(mkFee(90n)); note('fee ~0.5 sat/B', low.ok === false, { error: low.error ?? 'ACCEPTED' });
  assert.equal(low.ok, false); assert.match(low.error, /min relay fee|insufficient fee|fee not met/i);
  const okf = await send(mkFee(300n)); note('fee >1 sat/B accepted', okf.ok, { error: okf.error }); assert.ok(okf.ok);
});
