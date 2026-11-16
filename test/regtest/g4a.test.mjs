// G4-a regtest: a transaction whose sponsor input was signed by a SOFTWARE WalletConnect wallet (request -> JSON -> wallet -> response),
// verified by src/wizard.mjs, is accepted and mined by a REAL local BCHN regtest node.
// Evidence level: REGTEST + software wallet. NOT a real wallet (Paytaca/Selene untested), NOT mainnet.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { binToHex, lockingBytecodeToCashAddress, encodeLockingBytecodeP2pkh, hash160 } from '@bitauth/libauth';
import { provider, keys, tpl, locks } from '../harness.mjs';
import { buildChain } from '../../src/chain.mjs';
import { planSpend } from '../../src/spend.mjs';
import { declareFunding, newJob } from '../../src/k17.mjs';
import { prepareSign, verifySigned, findSponsorPath, requestToJson } from '../../src/wizard.mjs';
import { simWallet, derive } from '../wallet-sim.mjs';
import { startNode, stopNode, rpc, mine, coinbaseOf, send, height } from './node.mjs';

const pk = (k) => tpl(k).publicKey;
const F = 100000n;
const chain = buildChain({ pk: { V: pk(keys.V), W: pk(keys.W), A: pk(keys.A) }, lock: { V: locks.V, W: locks.W, A: locks.A }, F, fA: 2000n, tEnd: 300n }, { provider });
const roleKeys = { V: keys.V, W: keys.W, A: keys.A };
const wlock = (name, i) => encodeLockingBytecodeP2pkh(hash160(derive(name, i)));
const hexOf = (b) => binToHex(Uint8Array.from(b));
const addr = (lb) => lockingBytecodeToCashAddress({ bytecode: lb, prefix: 'bchtest' }).address;
const rec = []; const note = (name, ok, detail = {}) => rec.push({ name, ok, level: 'regtest+software-wallet', ...detail });
let nodeInfo; const st = {};

before(async () => { nodeInfo = await startNode(); nodeInfo.subversion = (await rpc('getnetworkinfo')).subversion; });
after(async () => {
  writeFileSync(new URL('../results-regtest-g4a.json', import.meta.url), JSON.stringify({ level: 'regtest+software-wallet', node: nodeInfo?.subversion, cases: rec }, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
  await stopNode();
});

async function outOf(txid, lockHex) {
  const t = await rpc('getrawtransaction', [txid, true]);
  const i = t.vout.findIndex((o) => o.scriptPubKey.hex === lockHex);
  assert.ok(i >= 0, 'output not found');
  return { txid, vout: i, satoshis: BigInt(Math.round(t.vout[i].value * 1e8)) };
}
// the whole wallet round trip, exactly as the app will do it (minus the relay): returns the verified hex + txid
function viaWallet(plan, sponsorUtxoLock, walletOpts = {}) {
  const sponsorPaths = plan.sponsors.map((s) => findSponsorPath(s.lockingBytecode, derive));
  const { request, expected } = prepareSign(plan, { provider, keys: roleKeys, SignatureTemplate, changeLock: wlock('change', 0), sponsorPaths });
  const response = simWallet(requestToJson(request), walletOpts);
  return { request, expected, response, ...(walletOpts.noVerify ? {} : verifySigned(expected, response, { derive })) };
}

test('node: regtest, mature coinbases for employer V and for the wallet address receive/3', async () => {
  assert.equal(nodeInfo.chain, 'regtest');
  const hV = await mine(1, locks.V); const hS = await mine(1, wlock('receive', 3)); await mine(100, locks.X);
  st.cbV = await coinbaseOf(hV[0]); st.cbS = await coinbaseOf(hS[0]);
  note('node start + 102 blocks', true, { subversion: nodeInfo.subversion });
});

test('funding: employer V pays F to the Funded address', async () => {
  const b = new TransactionBuilder({ provider });
  b.addInput({ txid: st.cbV.txid, vout: 0, satoshis: st.cbV.satoshis, lockingBytecode: hexOf(locks.V) }, tpl(keys.V).unlockP2PKH());
  b.addOutput({ to: addr(chain.locks.funded), amount: F });
  b.addOutput({ to: addr(locks.V), amount: st.cbV.satoshis - F - 1000n });
  const r = await send(b.build()); assert.ok(r.ok, JSON.stringify(r));
  await mine(1, locks.X);
  st.funding = await outOf(r.result, hexOf(chain.locks.funded));
});

test('F1 accept: sponsor input signed by the (software) wallet, accepted + mined by the real node, txid matches', async () => {
  const fundedUtxo = { ...st.funding, lockingBytecode: Uint8Array.from(chain.locks.funded) };
  const job = declareFunding(newJob(chain), fundedUtxo);
  const sponsor = { ...st.cbS, lockingBytecode: wlock('receive', 3) };
  const plan = planSpend({ chain, path: 'F1', utxo: fundedUtxo, sponsors: [sponsor], feeRate: 1, ctx: {}, job });
  const v = viaWallet(plan);
  // measurement only (nothing is sent): the node's own policy view of the same hex
  const tma = await rpc('testmempoolaccept', [[v.hex]]);
  assert.equal(tma[0].allowed, true, JSON.stringify(tma));
  const r = await send(v.hex); assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.result, v.txid, 'the node reports the same txid we computed from the verified bytes');
  const t = await rpc('getrawtransaction', [r.result, true]);
  assert.equal(t.size, v.size);
  assert.equal(t.vin[1].sequence, 0xfffffffe);
  await mine(1, locks.X);
  st.f1 = r.result;
  st.acc = await outOf(r.result, hexOf(chain.locks.accepted)); assert.equal(st.acc.satoshis, F);
  st.chg = await outOf(r.result, hexOf(wlock('change', 0)));
  note('F1 via software wallet: accepted + mined', true, { txid: r.result, size: t.size, fee: v.fee.toString(), inputPaths: v.request.inputPaths });
});

test('A1 pay: next spend uses the wallet change output (change/0) as sponsor; node accepts; worker output read back', async () => {
  const acc = { ...st.acc, lockingBytecode: Uint8Array.from(chain.locks.accepted) };
  const sponsor = { ...st.chg, lockingBytecode: wlock('change', 0) };
  const plan = planSpend({ chain, path: 'A1', utxo: acc, sponsors: [sponsor], feeRate: 1, ctx: { dryRun: true } });
  const v = viaWallet(plan);
  assert.deepEqual(v.request.inputPaths, [[1, 'change', 0]]);
  const r = await send(v.hex); assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.result, v.txid);
  await mine(1, locks.X);
  const w = await outOf(r.result, hexOf(locks.W)); assert.equal(w.satoshis, F, 'worker is paid exactly F');
  note('A1 via software wallet: accepted + mined, worker paid F', true, { txid: r.result });
});
