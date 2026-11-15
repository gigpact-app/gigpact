// G3-c: dispute paths (C2, A4, D1-D6) with timing boundaries on a REAL local BCHN regtest node.
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
const SCRIPT_FAIL = /mandatory-script-verify-flag-failed/;
let nodeInfo; const st = {};

before(async () => { nodeInfo = await startNode(); nodeInfo.subversion = (await rpc('getnetworkinfo')).subversion; });
after(async () => {
  writeFileSync(new URL('../results-regtest-g3c.json', import.meta.url), JSON.stringify({ level: 'regtest', node: nodeInfo?.subversion, cases: rec }, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
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


const lk = (k) => Uint8Array.from(chain.locks[k]);
const FA = 2000n;
// sends one library-built tx, mines a block, returns the txid and the next sponsor coin (the S-locked change output)
async function step(path, key, utxo, sp, ctx, job) {
  const g = mk({ utxo: { ...utxo, lockingBytecode: lk(key) }, path, sponsors: [sp], ctx, job });
  const r = await send(g.hex); assert.ok(r.ok, `${path}: ${JSON.stringify(r)}`);
  await mine(1, locks.X);
  return { g, txid: r.result, sp: sponsorUtxo(await outOf(r.result, hexOf(locks.S))) };
}
const payouts = async (txid) => { const t = await rpc('getrawtransaction', [txid, true]); const m = {}; for (const o of t.vout) (m[o.scriptPubKey.hex] ??= []).push(BigInt(Math.round(o.value * 1e8))); return m; };
// Funded -> F1 -> A3 -> C2 -> a fresh Dispute(phi=100) UTXO; returns { utxo, sp, txids }
async function toDispute100() {
  const u = await fund(); let sp = await spon();
  const f1 = await step('F1', 'funded', u, sp, {}, declareFunding(newJob(chain), u)); sp = f1.sp;
  const a3 = await step('A3', 'accepted', await outOf(f1.txid, hexOf(chain.locks.accepted)), sp, { tipHeight: await height() }); sp = a3.sp;
  const c2 = await step('C2', 'requested', await outOf(a3.txid, hexOf(chain.locks.requested)), sp, {}); sp = c2.sp;
  return { utxo: await outOf(c2.txid, hexOf(chain.locks.d100)), sp, txids: [f1.txid, a3.txid, c2.txid] };
}
const dg = (d, path, ctx = { phi: 100 }) => mk({ utxo: { ...d.utxo, lockingBytecode: lk('d100') }, path, sponsors: [d.sp], ctx });

test('setup: coinbases, tip = tEnd', async () => {
  const hV = await mine(1, locks.V); const hS = await mine(1, locks.S); await mine(100, locks.X);
  st.v = await coinbaseOf(hV[0]); st.s = await coinbaseOf(hS[0]);
  await mine(Number(TEND) - (await height()), locks.X);
  note('setup', true, { subversion: nodeInfo.subversion });
});

test('C2 -> Dispute(100): D1 worker wins (arbitrator fee fA), with negatives', async () => {
  const d = await toDispute100(); note('C2 objectClaim accepted (Requested -> Dispute100)', true, { txids: d.txids });
  const g = dg(d, 'D1');
  await expectReject('D1 signed by W instead of A', tamper(g, {}, { ...keys, A: keys.W }), SCRIPT_FAIL);
  await expectReject('D1 arbitrator fee fA-1 (W gets +1)', tamper(g, { outs: [{ ...g.plan.outs[0], amount: g.plan.outs[0].amount + 1n }, { ...g.plan.outs[1], amount: g.plan.outs[1].amount - 1n }] }), SCRIPT_FAIL);
  const r = await send(g.hex); assert.ok(r.ok, JSON.stringify(r)); await mine(1, locks.X);
  const p = await payouts(r.result);
  assert.deepEqual(p[hexOf(locks.W)], [F - FA]); assert.deepEqual(p[hexOf(locks.A)], [FA]);
  note('D1 accepted: W gets F-fA, A gets fA', true, { txid: r.result });
});

test('D2 employer wins; D3 split (with a wrong-split negative)', async () => {
  let d = await toDispute100(); let g = dg(d, 'D2');
  const r2 = await send(g.hex); assert.ok(r2.ok, JSON.stringify(r2)); await mine(1, locks.X);
  let p = await payouts(r2.result); assert.deepEqual(p[hexOf(locks.V)], [F - FA]); assert.deepEqual(p[hexOf(locks.A)], [FA]);
  note('D2 accepted: V gets F-fA, A gets fA', true, { txid: r2.result });
  d = await toDispute100(); g = dg(d, 'D3');
  const o = g.plan.outs;
  await expectReject('D3 unequal split (W +1, V -1)', tamper(g, { outs: [{ ...o[0], amount: o[0].amount + 1n }, { ...o[1], amount: o[1].amount - 1n }, o[2]] }), SCRIPT_FAIL);
  const r3 = await send(g.hex); assert.ok(r3.ok, JSON.stringify(r3)); await mine(1, locks.X);
  p = await payouts(r3.result); assert.deepEqual(p[hexOf(locks.W)], [(F - FA) / 2n]); assert.deepEqual(p[hexOf(locks.V)], [(F - FA) / 2n]); assert.deepEqual(p[hexOf(locks.A)], [FA]);
  note('D3 accepted: 49000 / 49000 / fA', true, { txid: r3.result });
});

test('D5 employer pays out; D6 worker waives (signer checks)', async () => {
  let d = await toDispute100(); let g = dg(d, 'D5');
  await expectReject('D5 signed by W instead of V', tamper(g, {}, { ...keys, V: keys.W }), SCRIPT_FAIL);
  let r = await send(g.hex); assert.ok(r.ok, JSON.stringify(r)); await mine(1, locks.X);
  assert.deepEqual((await payouts(r.result))[hexOf(locks.W)], [F]); note('D5 accepted: W gets F', true, { txid: r.result });
  d = await toDispute100(); g = dg(d, 'D6');
  await expectReject('D6 signed by V instead of W', tamper(g, {}, { ...keys, W: keys.V }), SCRIPT_FAIL);
  r = await send(g.hex); assert.ok(r.ok, JSON.stringify(r)); await mine(1, locks.X);
  assert.deepEqual((await payouts(r.result))[hexOf(locks.V)], [F]); note('D6 accepted: V gets F', true, { txid: r.result });
});

test('A4 openDispute: CLTV boundary tA4 = tEnd + G, then D4 on Dispute(50) pays half/half', async () => {
  const tA4 = Number(TEND) + 1008;
  const u = await fund(); let sp = await spon();
  const f1 = await step('F1', 'funded', u, sp, {}, declareFunding(newJob(chain), u)); sp = f1.sp;
  const acc = { ...(await outOf(f1.txid, hexOf(chain.locks.accepted))), lockingBytecode: lk('accepted') };
  await mine(tA4 - 1 - (await height()), locks.X); assert.equal(await height(), tA4 - 1);
  const early = mk({ utxo: acc, path: 'A4', sponsors: [sp], ctx: { dryRun: true } });
  const re = await send(early.hex);
  note('A4 at tip=tA4-1', re.ok === false, { error: re.error }); assert.equal(re.ok, false); assert.match(re.error, /bad-txns-nonfinal/);
  await mine(1, locks.X);
  await expectReject('A4 signed by W instead of V', tamper(mk({ utxo: acc, path: 'A4', sponsors: [sp], ctx: { tipHeight: tA4 } }), {}, { ...keys, V: keys.W }), SCRIPT_FAIL);
  const a4 = await step('A4', 'accepted', acc, sp, { tipHeight: tA4 }); note('A4 at tip=tA4 accepted', true, { txid: a4.txid });
  const d50 = { ...(await outOf(a4.txid, hexOf(chain.locks.d50))), lockingBytecode: lk('d50') };
  await mine(2015 - (await confs(a4.txid)), locks.X);
  const e = mk({ utxo: d50, path: 'D4', sponsors: [a4.sp], ctx: { phi: 50, dryRun: true } });
  const re2 = await send(e.hex);
  note('D4(50) at 2015 confirmations', re2.ok === false, { error: re2.error }); assert.equal(re2.ok, false); assert.match(re2.error, /non-BIP68-final/);
  await mine(1, locks.X);
  const ok = mk({ utxo: d50, path: 'D4', sponsors: [a4.sp], ctx: { phi: 50, confirmations: await confs(a4.txid) } });
  const r = await send(ok.hex); assert.ok(r.ok, JSON.stringify(r)); await mine(1, locks.X);
  const p = await payouts(r.result); assert.deepEqual(p[hexOf(locks.W)], [F / 2n]); assert.deepEqual(p[hexOf(locks.V)], [F / 2n]);
  note('D4(50) at 2016 confirmations accepted: W and V get F/2', true, { txid: r.result });
});

test('D4 fallback on Dispute(100): BIP68 boundary l (2015 rejected, 2016 accepted), all to W', async () => {
  const d = await toDispute100(); const created = d.txids[2];
  await mine(2015 - (await confs(created)), locks.X);
  const dry = dg(d, 'D4', { phi: 100, dryRun: true });
  const re = await send(dry.hex);
  note('D4(100) at 2015 confirmations', re.ok === false, { error: re.error }); assert.equal(re.ok, false); assert.match(re.error, /non-BIP68-final/);
  await mine(1, locks.X);
  const ok = dg(d, 'D4', { phi: 100, confirmations: await confs(created) });
  const r = await send(ok.hex); assert.ok(r.ok, JSON.stringify(r)); await mine(1, locks.X);
  assert.deepEqual((await payouts(r.result))[hexOf(locks.W)], [F]);
  note('D4(100) at 2016 confirmations accepted: W gets F', true, { txid: r.result });
});

