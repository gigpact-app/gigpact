// G3-a: happy path F1 -> A3 -> C1 on a REAL local BCHN regtest node (v29.2.0 expected).
// Evidence level: REGTEST (real node consensus + mempool policy; local; no wallet; no mainnet).
// Measured here, which R-VM cannot see: CLTV finality (tip vs locktime), BIP68 aging (confirmations vs sequence),
// sponsor nSequence on the wire, mempool acceptance of the library's real serialized txs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { binToHex, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { provider, keys, tpl, locks } from '../harness.mjs';
import { buildChain } from '../../src/chain.mjs';
import { planSpend, buildTx } from '../../src/spend.mjs';
import { declareFunding, newJob } from '../../src/k17.mjs';
import { startNode, stopNode, rpc, mine, coinbaseOf, send, height } from './node.mjs';

const pk = (k) => tpl(k).publicKey;
const TEND = 300n, F = 100000n;
const params = { pk: { V: pk(keys.V), W: pk(keys.W), A: pk(keys.A) }, lock: { V: locks.V, W: locks.W, A: locks.A }, F, fA: 2000n, tEnd: TEND };
const chain = buildChain(params, { provider });
const rec = []; const note = (name, ok, detail = {}) => { rec.push({ name, ok, level: 'regtest', ...detail }); };
const hexOf = (b) => binToHex(Uint8Array.from(b));
const addr = (lb) => lockingBytecodeToCashAddress({ bytecode: lb, prefix: 'bchtest' }).address;
let nodeInfo; const st = {};

before(async () => { nodeInfo = await startNode(); nodeInfo.subversion = (await rpc('getnetworkinfo')).subversion; });
after(async () => {
  writeFileSync(new URL('../results-regtest.json', import.meta.url), JSON.stringify({ level: 'regtest', node: nodeInfo?.subversion, cases: rec }, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
  await stopNode();
});

async function outOf(txid, lockHex) {
  const t = await rpc('getrawtransaction', [txid, true]);
  const i = t.vout.findIndex((o) => o.scriptPubKey.hex === lockHex);
  assert.ok(i >= 0, 'output not found');
  return { txid, vout: i, satoshis: BigInt(Math.round(t.vout[i].value * 1e8)) };
}
const sponsorUtxo = (u) => ({ ...u, lockingBytecode: locks.S });
const planAndBuild = (args) => { const plan = planSpend({ chain, ...args }); return { plan, ...buildTx(plan, { provider, keys, SignatureTemplate, changeLock: locks.S }) }; };
const confs = async (txid) => (await rpc('getrawtransaction', [txid, true])).confirmations;

test('node: regtest, mature coinbases for employer V and sponsor S', async () => {
  assert.equal(nodeInfo.chain, 'regtest');
  const hV = await mine(1, locks.V); const hS = await mine(1, locks.S); await mine(100, locks.X);
  st.cbV = await coinbaseOf(hV[0]); st.cbS = await coinbaseOf(hS[0]);
  assert.ok((await height()) >= 102);
  note('node start + 102 blocks', true, { subversion: nodeInfo.subversion });
});

test('funding: employer V pays F to the Funded address (real P2SH32 output), confirmed', async () => {
  const b = new TransactionBuilder({ provider });
  b.addInput({ txid: st.cbV.txid, vout: 0, satoshis: st.cbV.satoshis, lockingBytecode: hexOf(locks.V) }, tpl(keys.V).unlockP2PKH());
  b.addOutput({ to: addr(chain.locks.funded), amount: F });
  b.addOutput({ to: addr(locks.V), amount: st.cbV.satoshis - F - 1000n });
  const r = await send(b.build()); assert.ok(r.ok, JSON.stringify(r));
  st.fundTxid = r.result; await mine(1, locks.X);
  st.funding = await outOf(st.fundTxid, hexOf(chain.locks.funded));
  assert.equal(st.funding.satoshis, F);
  note('funding tx accepted + confirmed', true, { txid: st.fundTxid });
});

test('F1 accept: K17 declared outpoint, library tx accepted by the node and mined', async () => {
  const fundedUtxo = { ...st.funding, lockingBytecode: Uint8Array.from(chain.locks.funded) };
  const job = declareFunding(newJob(chain), fundedUtxo);
  const { hex } = planAndBuild({ utxo: fundedUtxo, path: 'F1', sponsors: [sponsorUtxo(st.cbS)], feeRate: 1, ctx: {}, job });
  const r = await send(hex); assert.ok(r.ok, JSON.stringify(r));
  st.f1 = r.result;
  const t = await rpc('getrawtransaction', [st.f1, true]);
  const seqs = t.vin.map((v) => v.sequence);
  assert.equal(seqs[1], 0xfffffffe, 'sponsor nSequence on the wire');
  await mine(1, locks.X);
  st.acc = await outOf(st.f1, hexOf(chain.locks.accepted)); assert.equal(st.acc.satoshis, F);
  st.sp = await outOf(st.f1, hexOf(locks.S));
  note('F1 accepted + mined', true, { txid: st.f1, sequences: seqs, size: t.size });
});

test('A3 claim: CLTV boundary on the node (tip=tEnd-1 rejected, tip=tEnd accepted)', async () => {
  await mine(Number(TEND) - 1 - (await height()), locks.X);
  assert.equal(await height(), Number(TEND) - 1);
  const acc = { ...st.acc, lockingBytecode: Uint8Array.from(chain.locks.accepted) };
  const early = planAndBuild({ utxo: acc, path: 'A3', sponsors: [sponsorUtxo(st.sp)], ctx: { dryRun: true } });
  const re = await send(early.hex);
  note('A3 at tip=tEnd-1', re.ok === false, { error: re.error });
  assert.equal(re.ok, false, 'node must reject A3 at tip=tEnd-1');
  await mine(1, locks.X); assert.equal(await height(), Number(TEND));
  const ok = planAndBuild({ utxo: acc, path: 'A3', sponsors: [sponsorUtxo(st.sp)], ctx: { tipHeight: Number(TEND) } });
  const ra = await send(ok.hex); assert.ok(ra.ok, JSON.stringify(ra));
  st.a3 = ra.result; await mine(1, locks.X);
  st.req = await outOf(st.a3, hexOf(chain.locks.requested)); st.sp = await outOf(st.a3, hexOf(locks.S));
  note('A3 at tip=tEnd accepted + mined', true, { txid: st.a3 });
});

test('C1 complete: BIP68 boundary on the node (431 confirmations rejected, 432 accepted)', async () => {
  const req = { ...st.req, lockingBytecode: Uint8Array.from(chain.locks.requested) };
  await mine(431 - (await confs(st.a3)), locks.X); assert.equal(await confs(st.a3), 431);
  const early = planAndBuild({ utxo: req, path: 'C1', sponsors: [sponsorUtxo(st.sp)], ctx: { dryRun: true } });
  const re = await send(early.hex);
  note('C1 at 431 confirmations', re.ok === false, { error: re.error });
  assert.equal(re.ok, false, 'node must reject C1 at 431 confirmations');
  await mine(1, locks.X); assert.equal(await confs(st.a3), 432);
  const ok = planAndBuild({ utxo: req, path: 'C1', sponsors: [sponsorUtxo(st.sp)], ctx: { confirmations: 432 } });
  const ra = await send(ok.hex); assert.ok(ra.ok, JSON.stringify(ra));
  st.c1 = ra.result; await mine(1, locks.X);
  const w = await outOf(st.c1, hexOf(locks.W)); assert.equal(w.satoshis, F);
  note('C1 at 432 confirmations accepted + mined; worker received F', true, { txid: st.c1 });
});
