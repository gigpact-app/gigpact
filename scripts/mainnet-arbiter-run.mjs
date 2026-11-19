// Mainnet run of the dispute paths that the app has no button for: C2 (objectClaim) and the arbiter decisions D1, D2, D3,
// plus D5 (organizer pays) and D6 (worker waives) on a dispute coin. NOT part of the web app: a command-line script that uses the
// same library as the app (src/chain.mjs, src/spend.mjs, src/k17.mjs) with local keys.
//
// Why a separate arbiter key: the app's ARBITER_PK has no kept private key, so no arbiter decision can be signed for pacts made in
// the app. This run builds its own pacts with an arbiter key generated here and kept in tools/arbiter-run.json (not in the repository).
// It does not change web/config.js, so pacts made in the app are not affected.
//
// Commands (run from the repository root):
//   node scripts/mainnet-arbiter-run.mjs init       make keys, print the address to fund and the amount
//   node scripts/mainnet-arbiter-run.mjs fund       pay each test pact's funding address from the sponsor coin
//   node scripts/mainnet-arbiter-run.mjs accept     F1 for each pact (needs 1 confirmation of its funding payment)
//   node scripts/mainnet-arbiter-run.mjs settle     A3 (after the event end block), C2, then the decision of each pact
//   node scripts/mainnet-arbiter-run.mjs report     write docs/evidence/M9-arbiter-run.md (transaction ids, no keys)
//   node scripts/mainnet-arbiter-run.mjs selftest   the same flow on an in-memory ledger with the libauth VM (no network, no keys kept)
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { SignatureTemplate, TransactionBuilder, ElectrumNetworkProvider, MockNetworkProvider } from 'cashscript';
import { secp256k1, hash160, encodeLockingBytecodeP2pkh, lockingBytecodeToCashAddress, decodeTransactionBch, hashTransactionUiOrder, binToHex, hexToBin, createVirtualMachineBch2026 } from '@bitauth/libauth';
import { buildChain } from '../src/chain.mjs';
import { planSpend, buildTx } from '../src/spend.mjs';
import { declareFunding, newJob } from '../src/k17.mjs';
import { failoverProvider } from '../web/failover.js';

const STATE = new URL('../tools/arbiter-run.json', import.meta.url);
const EVIDENCE = new URL('../docs/evidence/M9-arbiter-run.md', import.meta.url);
const FA = 2000n, F0 = 10000n;
// one pact per ending, each with its own F so every pact has its own contract addresses
const PACTS = [
  { id: 'P1', end: 'D1', what: 'arbiter decides for the worker' },
  { id: 'P2', end: 'D3', what: 'arbiter splits' },
  { id: 'P3', end: 'D2', what: 'arbiter decides for the organizer' },
  { id: 'P4', end: 'D5', what: 'organizer pays out' },
  { id: 'P5', end: 'D6', what: 'worker waives' },
].map((p, i) => ({ ...p, F: F0 + BigInt(i) * 100n }));
const STAGE = { F1: 'funded', A3: 'accepted', C2: 'requested', D1: 'd100', D2: 'd100', D3: 'd100', D5: 'd100', D6: 'd100' };
const NEXT = { F1: 'accepted', A3: 'requested', C2: 'd100' };
const SELFTEST = process.argv[2] === 'selftest';
const cmd = process.argv[2];

const die = (m) => { console.error(`\nSTOP: ${m}\n`); process.exit(1); };
const rnd = () => { let k; do { k = crypto.getRandomValues(new Uint8Array(32)); } while (!secp256k1.validatePrivateKey(k)); return k; };
const pubOf = (k) => secp256k1.derivePublicKeyCompressed(k);
const lockOf = (k) => encodeLockingBytecodeP2pkh(hash160(pubOf(k)));
const sameB = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- network (real) or in-memory ledger (selftest) ----------------------------------------------------------
function realNet() {
  const hosts = ['bch.imaginary.cash', 'bitcoincash.network'];
  const provider = failoverProvider(hosts.map((hostname) => new ElectrumNetworkProvider('mainnet', { hostname })));
  return {
    provider, prefix: 'bitcoincash',
    tip: () => provider.getBlockHeight(),
    utxos: (a) => provider.getUtxos(a),
    send: (hex) => provider.sendRawTransaction(hex),
    confs: async (txid) => { const r = await provider.performRequest('blockchain.transaction.get', txid, true); return Number(r?.confirmations ?? 0); },
  };
}
function memNet() {
  const provider = new MockNetworkProvider({});
  const ledger = new Map(); let height = 1000; const vm = createVirtualMachineBch2026();
  const net = {
    provider, prefix: provider.network === 'mainnet' ? 'bitcoincash' : 'bchtest', ledger,
    mine: (n) => { height += n; }, tip: async () => height,
    utxos: async () => [], confs: async () => 1,
    seed(txid, vout, lock, value) { ledger.set(`${txid}:${vout}`, { lockingBytecode: lock, valueSatoshis: value }); },
    async send(hex) {
      const tx = decodeTransactionBch(hexToBin(hex)); if (typeof tx === 'string') throw new Error(tx);
      const src = tx.inputs.map((i) => { const s = ledger.get(`${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}`); if (!s) throw new Error('input not in ledger (already spent?)'); return s; });
      src.forEach((_, i) => { const r = vm.verify({ inputIndex: i, transaction: tx, sourceOutputs: src }); if (r !== true) throw new Error(`input ${i}: ${r}`); });
      if (tx.locktime > 0 && tx.locktime > height) throw new Error('non-final locktime');
      const txid = binToHex(hashTransactionUiOrder(hexToBin(hex)));
      tx.inputs.forEach((i) => ledger.delete(`${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}`));
      tx.outputs.forEach((o, n) => ledger.set(`${txid}:${n}`, { lockingBytecode: o.lockingBytecode, valueSatoshis: o.valueSatoshis }));
      return txid;
    },
  };
  return net;
}

// ---- state ----------------------------------------------------------------------------------------------------
let mem = null; // selftest state is not written to disk
const load = () => (SELFTEST ? mem : existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null);
const save = (s) => { if (SELFTEST) { mem = s; return; } mkdirSync(new URL('../tools/', import.meta.url), { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 1)); try { chmodSync(STATE, 0o600); } catch { /* best effort */ } };
const keysOf = (s) => Object.fromEntries(Object.entries(s.keys).map(([k, v]) => [k, hexToBin(v)]));

function chainOf(s, net, p) {
  const k = keysOf(s), tEnd = BigInt(s.tEnd);
  const params = { pk: { V: pubOf(k.V), W: pubOf(k.W), A: pubOf(k.A) }, lock: { V: lockOf(k.V), W: lockOf(k.W), A: lockOf(k.A) }, F: p.F, fA: FA, tEnd };
  return buildChain(params, { provider: net.provider });
}
const addrOf = (net, lock) => lockingBytecodeToCashAddress({ bytecode: lock, prefix: net.prefix }).address;
const sponsorOf = (s) => ({ txid: s.sponsor.txid, vout: s.sponsor.vout, satoshis: BigInt(s.sponsor.satoshis), lockingBytecode: lockOf(hexToBin(s.keys.S)) });
const decodeOut = (hex) => { const tx = decodeTransactionBch(hexToBin(hex)); return { txid: binToHex(hashTransactionUiOrder(hexToBin(hex))), outputs: tx.outputs }; };

// after a broadcast: the next sponsor coin is the change output (the one locked by the sponsor key)
function takeChange(s, net, hex) {
  const { outputs } = decodeOut(hex), sl = lockOf(hexToBin(s.keys.S));
  const i = outputs.findIndex((o, n) => n > 0 && sameB(o.lockingBytecode, sl));
  if (i < 0) die('this transaction left no change for the next step: the sponsor coin is used up. Send more to the funding address and run init again is NOT needed: send, then re-run the same command.');
  s.sponsor = { txid: decodeOut(hex).txid, vout: i, satoshis: outputs[i].valueSatoshis.toString() };
}

async function broadcast(net, hex, label) {
  const want = decodeOut(hex).txid;
  const got = await net.send(hex);
  if (typeof got === 'string' && got.toLowerCase() !== want) die(`${label}: the network reported ${got}, expected ${want}. Check an explorer before going on.`);
  return want;
}

// ---- commands -------------------------------------------------------------------------------------------------
function cmdInit(net) {
  if (load()) die('tools/arbiter-run.json already exists. Keep it: it holds the keys of the test pacts. Delete it only if nothing was sent to its address.');
  const keys = { V: rnd(), W: rnd(), A: rnd(), S: rnd() };
  const s = { keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, binToHex(v)])), tEnd: 0, sponsor: null, pacts: Object.fromEntries(PACTS.map((p) => [p.id, { F: p.F.toString(), steps: {} }])) };
  save(s);
  const total = PACTS.reduce((a, p) => a + p.F, 0n);
  console.log(`Keys made and saved in tools/arbiter-run.json (do not share this file).`);
  console.log(`\nSend ONE payment to this address (a plain BCH address of this script only):\n  ${addrOf(net, lockOf(keys.S))}`);
  console.log(`\nAmount: ${PACTS.length} test pacts lock ${total} sat in total (it ends at addresses whose keys are in the file) plus network fees.`);
  console.log(`Recommended: 0.0008 BCH (80000 sat) in one payment; the five pacts need about 71500 sat (51000 locked, about 20500 network fees), the rest stays in the sponsor coin. Wait for 1 confirmation, then run: node scripts/mainnet-arbiter-run.mjs fund`);
}

async function cmdFund(net) {
  const s = load() ?? die('run init first');
  if (!s.sponsor) {
    const sl = lockOf(hexToBin(s.keys.S)), list = (await net.utxos(addrOf(net, sl))).filter((u) => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1));
    if (!list.length) die('nothing found at the funding address yet. Wait for the payment, then run fund again.');
    const u = list[0]; s.sponsor = { txid: u.txid, vout: u.vout, satoshis: u.satoshis.toString() };
    console.log(`sponsor coin: ${u.txid}:${u.vout} (${u.satoshis} sat)`);
  }
  if (!s.tEnd) { const t = await net.tip(); s.tEnd = t + 3; console.log(`tip ${t}; event end block set to ${s.tEnd}`); }
  save(s);
  for (const p of PACTS) {
    const st = s.pacts[p.id]; if (st.steps.fund) { console.log(`${p.id} fund: already ${st.steps.fund.txid}`); continue; }
    const chain = chainOf(s, net, p), sp = sponsorOf(s), fee = 500n;
    if (sp.satoshis < p.F + fee + 546n) die(`the sponsor coin (${sp.satoshis} sat) cannot pay ${p.id} (needs about ${p.F + fee + 546n}). Send more to the funding address, wait for 1 confirmation and run fund again.`);
    const b = new TransactionBuilder({ provider: net.provider });
    b.addInput({ txid: sp.txid, vout: sp.vout, satoshis: sp.satoshis, lockingBytecode: binToHex(sp.lockingBytecode) }, new SignatureTemplate(hexToBin(s.keys.S)).unlockP2PKH());
    b.addOutput({ to: chain.addresses.funded, amount: p.F });
    b.addOutput({ to: addrOf(net, sp.lockingBytecode), amount: sp.satoshis - p.F - fee });
    const hex = b.build(), txid = await broadcast(net, hex, `${p.id} fund`);
    st.steps.fund = { txid, fee: fee.toString(), out: 0 }; st.funded = { txid, vout: 0, satoshis: p.F.toString() };
    s.sponsor = { txid, vout: 1, satoshis: (sp.satoshis - p.F - fee).toString() }; save(s);
    console.log(`${p.id} fund   ${p.F} sat  ${txid}`);
  }
  console.log('\nNext: wait for 1 confirmation (about 10 minutes), then: node scripts/mainnet-arbiter-run.mjs accept');
}

// one library-built spend, signed with the local keys, broadcast; records it
async function spend(s, net, p, path, ctx = {}) {
  const st = s.pacts[p.id], chain = chainOf(s, net, p), k = { ...keysOf(s) }, sp = sponsorOf(s);
  const cur = st.cur ?? st.funded;
  const utxo = { txid: cur.txid, vout: cur.vout, satoshis: BigInt(cur.satoshis), lockingBytecode: Uint8Array.from(chain.locks[STAGE[path]]) };
  let job; if (path === 'F1') job = declareFunding(newJob(chain), utxo);
  const plan = planSpend({ chain, path, utxo, sponsors: [sp], feeRate: 1, ctx, job });
  const r = buildTx(plan, { provider: net.provider, keys: k, SignatureTemplate, changeLock: lockOf(k.S) });
  const txid = await broadcast(net, r.hex, `${p.id} ${path}`);
  st.steps[path] = { txid, fee: r.fee.toString(), size: r.size, outs: plan.outs.map((o) => ({ amount: o.amount.toString() })) };
  if (NEXT[path]) st.cur = { txid, vout: 0, satoshis: cur.satoshis }; else st.cur = null;
  takeChange(s, net, r.hex); save(s);
  console.log(`${p.id} ${path.padEnd(3)} ${txid}  fee ${r.fee} sat  ${r.size} bytes`);
}

async function cmdAccept(net) {
  const s = load() ?? die('run init and fund first');
  for (const p of PACTS) {
    const st = s.pacts[p.id]; if (!st.steps.fund) die(`${p.id} is not funded: run fund first`);
    if (st.steps.F1) { console.log(`${p.id} F1: already ${st.steps.F1.txid}`); continue; }
    const c = await net.confs(st.steps.fund.txid);
    if (c < 1) die(`${p.id}: the funding payment has ${c} confirmations. Wait for 1 (the app waits too), then run accept again.`);
    await spend(s, net, p, 'F1');
  }
  console.log(`\nNext: wait until the chain is at block ${s.tEnd} or higher, then: node scripts/mainnet-arbiter-run.mjs settle`);
}

async function cmdSettle(net) {
  const s = load() ?? die('run init, fund and accept first');
  const tip = await net.tip();
  if (tip < s.tEnd) die(`the chain is at block ${tip}; the event end is block ${s.tEnd} (${s.tEnd - tip} more blocks, about ${(s.tEnd - tip) * 10} minutes). Run settle again then.`);
  for (const p of PACTS) {
    const st = s.pacts[p.id]; if (!st.steps.F1) die(`${p.id}: accept (F1) is not done`);
    if (!st.steps.A3) await spend(s, net, p, 'A3', { tipHeight: tip });
    if (!st.steps.C2) await spend(s, net, p, 'C2');
    if (!st.steps[p.end]) await spend(s, net, p, p.end, { phi: 100 });
  }
  console.log('\nAll pacts are through. Next: node scripts/mainnet-arbiter-run.mjs report');
}

function cmdReport(net) {
  const s = load() ?? die('nothing to report');
  const ex = (t) => `[${t.slice(0, 12)}…](https://3xpl.com/bitcoin-cash/transaction/${t})`;
  const names = { fund: 'Funding payment', F1: 'F1 accept', A3: 'A3 claim', C2: 'C2 objectClaim' };
  let md = `# M9: dispute paths on mainnet (script run, not through the app)\n\nDate: ${new Date().toISOString().slice(0, 10)}. Event end block ${s.tEnd}. Run by \`scripts/mainnet-arbiter-run.mjs\` with local keys, using the same library as the app (\`src/chain.mjs\`, \`src/spend.mjs\`, \`src/k17.mjs\`). The arbiter key of these pacts is a test key made for this run; it is not the \`ARBITER_PK\` of the app. The app has no button for any of these steps.\n\n`;
  md += `| Pact | Step | Path | Transaction | Fee (sat) |\n|---|---|---|---|---|\n`;
  for (const p of PACTS) for (const [k, v] of Object.entries(s.pacts[p.id].steps)) md += `| ${p.id} (F ${p.F} sat, ${p.what}) | ${names[k] ?? `${k} decision`} | ${k === 'fund' ? '-' : k} | ${ex(v.txid)} | ${v.fee} |\n`;
  md += `\nFull ids:\n\n\`\`\`\n${PACTS.flatMap((p) => Object.entries(s.pacts[p.id].steps).map(([k, v]) => `${p.id} ${k} ${v.txid}`)).join('\n')}\n\`\`\`\n`;
  if (SELFTEST) { console.log(md); return; }
  mkdirSync(new URL('../docs/evidence/', import.meta.url), { recursive: true }); writeFileSync(EVIDENCE, md); console.log('written: docs/evidence/M9-arbiter-run.md (no keys in it)');
}

async function cmdSelftest() {
  const net = memNet(); const keys = { V: rnd(), W: rnd(), A: rnd(), S: rnd() };
  const s = { keys: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, binToHex(v)])), tEnd: 0, sponsor: null, pacts: Object.fromEntries(PACTS.map((p) => [p.id, { F: p.F.toString(), steps: {} }])) };
  s.sponsor = { txid: 'ab'.repeat(32), vout: 0, satoshis: '100000' }; net.seed(s.sponsor.txid, 0, lockOf(keys.S), 100000n); save(s);
  s.tEnd = (await net.tip()) + 3; save(s);
  const total0 = 100000n;
  await cmdFund(net); await cmdAccept(net);
  net.mine(3); await cmdSettle(net);
  const t = load(); const fees = Object.values(t.pacts).flatMap((x) => Object.values(x.steps)).reduce((a, x) => a + BigInt(x.fee), 0n);
  console.log(`\nselftest ok. total fees ${fees} sat; sponsor left ${t.sponsor.satoshis} sat of ${total0}.`);
  const pay = (lock) => [...net.ledger.values()].filter((o) => sameB(o.lockingBytecode, lock)).map((o) => o.valueSatoshis.toString());
  console.log('payouts  W:', pay(lockOf(keys.W)).join(','), ' V:', pay(lockOf(keys.V)).join(','), ' A:', pay(lockOf(keys.A)).join(','));
  cmdReport(net);
}

const net = SELFTEST ? null : realNet();
try {
  if (cmd === 'init') cmdInit(net);
  else if (cmd === 'fund') await cmdFund(net);
  else if (cmd === 'accept') await cmdAccept(net);
  else if (cmd === 'settle') await cmdSettle(net);
  else if (cmd === 'report') cmdReport(net);
  else if (cmd === 'selftest') await cmdSelftest();
  else console.log('usage: node scripts/mainnet-arbiter-run.mjs init | fund | accept | settle | report | selftest');
} catch (e) { die(e?.message || String(e)); }
process.exit(0);
