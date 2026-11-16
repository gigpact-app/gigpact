// web/accept.js (worker accept via a connected wallet) with a SOFTWARE wallet and a FAKE network.
// Evidence level: R-VM + software wallet. Not regtest, not a real wallet, not mainnet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MockNetworkProvider } from 'cashscript';
import { binToHex, lockingBytecodeToCashAddress, encodeLockingBytecodeP2pkh, hash160, decodeTransactionBch, hexToBin } from '@bitauth/libauth';
globalThis.location = { search: '' };
const { newKey, pubOf, lockOfPk, UiError, chainFor } = await import('../web/pact.js');
const { acceptPact, cancelPact, settlePact, declareFromChain, walletCoins, pickSponsors } = await import('../web/accept.js');
const { simWallet, derive, walletKey } = await import('./wallet-sim.mjs');

const kW = newKey(), kV = newKey();
const pact = { name: 'Friday set', F: 100000n, tEnd: 960000, pkW: pubOf(kW), lockW: lockOfPk(pubOf(kW)), pkV: pubOf(kV), lockV: lockOfPk(pubOf(kV)) };
const mock = new MockNetworkProvider();
const chain = chainFor(pact, mock);
const walletAddr = (name, i) => lockingBytecodeToCashAddress({ bytecode: encodeLockingBytecodeP2pkh(hash160(derive(name, i))), prefix: 'bitcoincash' }).address;
const T = (n) => `${n}`.padStart(2, '0').repeat(32);

// fake network: utxos by address, records what is broadcast
function net({ funded = [{ txid: T(11), vout: 0, satoshis: 100000n }], coins = { [walletAddr('receive', 3)]: [{ txid: T(22), vout: 1, satoshis: 30000n }] }, sendResult } = {}) {
  const sent = [];
  const p = Object.assign(Object.create(mock), {
    getUtxos: async (a) => (a === chain.addresses.funded ? funded : coins[a] ?? []),
    sendRawTransaction: async (hex) => { sent.push(hex); return sendResult ? sendResult(hex) : binToHex(hexToBin(hex).length ? txidOf(hex) : new Uint8Array()); },
  });
  return { p, sent };
}
import { hashTransactionUiOrder } from '@bitauth/libauth';
const txidOf = (hex) => hashTransactionUiOrder(hexToBin(hex));
const mgr = (opts = {}) => ({
  getPubkey: (child, i) => derive(['receive', 'change'][child] ?? 'defi', Number(i)),
  signTransaction: async (req) => simWallet(JSON.stringify(req), opts),
  calls: 0,
});
const bad = (promise, re) => assert.rejects(promise, (e) => re.test(e.message));

test('accept: funded pact + wallet coin -> wallet signs, answer verified, broadcast once, txid matches', async () => {
  const { p, sent } = net();
  const steps = [];
  const r = await acceptPact({ pact, keyW: kW, mgr: mgr(), provider: p, onStep: (s) => steps.push(s) });
  assert.equal(sent.length, 1);
  assert.equal(r.txid, binToHex(txidOf(sent[0])));
  const tx = decodeTransactionBch(hexToBin(sent[0]));
  assert.equal(tx.inputs.length, 2);                                     // contract + one sponsor
  assert.equal(tx.outputs[0].valueSatoshis, 100000n);                    // the pact money moves intact to the Accepted contract
  assert.equal(binToHex(tx.outputs[0].lockingBytecode), binToHex(chain.locks.accepted));
  assert.ok(r.fee >= BigInt(r.size) && r.fee < BigInt(r.size) * 2n + 10n);
  assert.deepEqual(steps.length, 4);
});

test('accept: smallest sufficient single coin is chosen; two coins are used only when no single one is enough', async () => {
  const a = walletAddr('receive', 0), b = walletAddr('change', 1), c = walletAddr('receive', 5);
  const { p, sent } = net({ coins: { [a]: [{ txid: T(31), vout: 0, satoshis: 900000n }], [b]: [{ txid: T(32), vout: 0, satoshis: 8000n }], [c]: [{ txid: T(33), vout: 0, satoshis: 3000n }] } });
  await acceptPact({ pact, keyW: kW, mgr: mgr(), provider: p });
  let tx = decodeTransactionBch(hexToBin(sent[0]));
  assert.equal(tx.inputs.length, 2);
  assert.equal(binToHex(tx.inputs[1].outpointTransactionHash), T(32), 'the 8,000 sat coin is the smallest that covers fee allowance + change floor (3,546 sat); the 3,000 sat coin is too small');
  const two = net({ coins: { [b]: [{ txid: T(34), vout: 0, satoshis: 2500n }], [c]: [{ txid: T(35), vout: 0, satoshis: 2500n }] } });
  await acceptPact({ pact, keyW: kW, mgr: mgr(), provider: two.p });
  tx = decodeTransactionBch(hexToBin(two.sent[0]));
  assert.equal(tx.inputs.length, 3);
});

test('accept: refuses before asking the wallet when the pact is not exactly funded', async () => {
  for (const [funded, re] of [[[], /not funded/], [[{ txid: T(11), vout: 0, satoshis: 99999n }], /Exactly one output of 100000 sat/], [[{ txid: T(11), vout: 0, satoshis: 100000n }, { txid: T(12), vout: 0, satoshis: 5000n }], /2 outputs/], [[{ txid: T(11), vout: 0, satoshis: 100000n }, { txid: T(12), vout: 0, satoshis: 100000n }], /2 outputs/]]) {
    const { p, sent } = net({ funded }); const m = mgr(); let asked = false; m.signTransaction = async () => { asked = true; };
    await bad(acceptPact({ pact, keyW: kW, mgr: m, provider: p }), re);
    assert.equal(asked, false); assert.equal(sent.length, 0);
  }
});

test('accept: wallet without enough coins -> plain message, wallet never asked', async () => {
  const { p } = net({ coins: { [walletAddr('receive', 0)]: [{ txid: T(41), vout: 0, satoshis: 900n }] } });
  const m = mgr(); let asked = false; m.signTransaction = async () => { asked = true; };
  await bad(acceptPact({ pact, keyW: kW, mgr: m, provider: p }), /needs a little more Bitcoin Cash/);
  assert.equal(asked, false);
});

test('accept: token coins and unrelated addresses are never used as sponsors', async () => {
  const a = walletAddr('receive', 2);
  const { p } = net({ coins: { [a]: [{ txid: T(51), vout: 0, satoshis: 50000n, token: { category: 'aa'.repeat(32), amount: 1n } }] } });
  await bad(acceptPact({ pact, keyW: kW, mgr: mgr(), provider: p }), /needs a little more/);
});

test('accept: a misbehaving wallet is caught before anything is broadcast', async () => {
  const cases = [
    ['refused', { error: 'user rejected' }, /refused/],
    ['wrong sighash', { sighash: 0x41 }, /hash type/],
    ['unsigned', { skip: true }, /unlocking script is 0 bytes/],
    ['wrong key', { keyFor: (n, i) => walletKey(n, i + 1) }, /does not match the sponsor address/],
    ['altered output', { mutate: (tx) => { tx.outputs[0] = { ...tx.outputs[0], valueSatoshis: tx.outputs[0].valueSatoshis - 1n }; } }, /differs from the requested/],
  ];
  for (const [name, opts, re] of cases) {
    const { p, sent } = net();
    await bad(acceptPact({ pact, keyW: kW, mgr: mgr(opts), provider: p }), re);
    assert.equal(sent.length, 0, `${name}: nothing broadcast`);
  }
});

test('accept: a different txid from the network is reported, not hidden', async () => {
  const { p } = net({ sendResult: () => 'ab'.repeat(32) });
  await bad(acceptPact({ pact, keyW: kW, mgr: mgr(), provider: p }), /another transaction id/);
});

test('helpers: pickSponsors and declareFromChain edge cases', () => {
  const lock = encodeLockingBytecodeP2pkh(hash160(derive('change', 0)));
  assert.throws(() => pickSponsors([], lock), UiError);
  assert.equal(pickSponsors([{ satoshis: 5000n }, { satoshis: 4000n }], lock).length, 1);
  assert.throws(() => declareFromChain(chain, [{ txid: T(1), vout: 0, satoshis: 100000n, token: { category: 'aa'.repeat(32), amount: 0n } }]), /token/);
});

test('cancel (F2): a wrongly sized payment (30,000 instead of 100,000) is returned to the refund address, signed by V, fee from the wallet', async () => {
  const { p, sent } = net({ funded: [{ txid: T(61), vout: 0, satoshis: 30000n }] });
  const r = await cancelPact({ pact, keyV: kV, mgr: mgr(), provider: p });
  assert.equal(sent.length, 1);
  assert.equal(r.txid, binToHex(txidOf(sent[0])));
  assert.equal(r.returned, 30000n);
  const tx = decodeTransactionBch(hexToBin(sent[0]));
  assert.equal(tx.inputs.length, 2);
  assert.equal(tx.outputs[0].valueSatoshis, 30000n);
  assert.equal(binToHex(tx.outputs[0].lockingBytecode), binToHex(pact.lockV));
  assert.equal(binToHex(tx.inputs[0].outpointTransactionHash), T(61));
});

test('cancel (F2): nothing to take back, token-only output, wrong key and a misbehaving wallet are refused with nothing broadcast', async () => {
  let n = net({ funded: [] }); await bad(cancelPact({ pact, keyV: kV, mgr: mgr(), provider: n.p }), /nothing to take back/); assert.equal(n.sent.length, 0);
  n = net({ funded: [{ txid: T(62), vout: 0, satoshis: 30000n, token: { category: 'aa'.repeat(32), amount: 1n } }] });
  await bad(cancelPact({ pact, keyV: kV, mgr: mgr(), provider: n.p }), /carries a token/); assert.equal(n.sent.length, 0);
  n = net({ funded: [{ txid: T(63), vout: 0, satoshis: 30000n }] });
  await assert.rejects(cancelPact({ pact, keyV: kW, mgr: mgr(), provider: n.p })); assert.equal(n.sent.length, 0); // W's key cannot satisfy the V check
  n = net({ funded: [{ txid: T(64), vout: 0, satoshis: 30000n }] });
  await bad(cancelPact({ pact, keyV: kV, mgr: mgr({ sighash: 0x41 }), provider: n.p }), /hash type/); assert.equal(n.sent.length, 0);
});

test('settle: A1 pay (V) moves the Accepted money to the worker payout, A2 waive (W) to the organizer refund', async () => {
  const acc = { [chain.addresses.accepted]: [{ txid: T(71), vout: 0, satoshis: 100000n }], [walletAddr('receive', 3)]: [{ txid: T(22), vout: 1, satoshis: 30000n }] };
  for (const [path, key, lock] of [['A1', kV, pact.lockW], ['A2', kW, pact.lockV]]) {
    const { p, sent } = net({ coins: acc });
    const r = await settlePact({ pact, path, key, mgr: mgr(), provider: p });
    assert.equal(sent.length, 1); assert.equal(r.txid, binToHex(txidOf(sent[0])));
    const tx = decodeTransactionBch(hexToBin(sent[0]));
    assert.equal(tx.outputs[0].valueSatoshis, 100000n); assert.equal(binToHex(tx.outputs[0].lockingBytecode), binToHex(lock));
    assert.equal(binToHex(tx.inputs[0].outpointTransactionHash), T(71));
  }
});

test('settle: A3 claim waits for tEnd; wrong amount, nothing there, wrong key and unknown path are refused with nothing broadcast', async () => {
  const coins = (sat) => ({ [chain.addresses.accepted]: [{ txid: T(72), vout: 0, satoshis: sat }], [walletAddr('receive', 3)]: [{ txid: T(22), vout: 1, satoshis: 30000n }] });
  let n = net({ coins: coins(100000n) }); n.p.getBlockHeight = async () => 959999;
  await bad(settlePact({ pact, path: 'A3', key: kW, mgr: mgr(), provider: n.p }), /Not yet/); assert.equal(n.sent.length, 0);
  n = net({ coins: coins(100000n) }); n.p.getBlockHeight = async () => 960000;
  const r = await settlePact({ pact, path: 'A3', key: kW, mgr: mgr(), provider: n.p });
  const tx = decodeTransactionBch(hexToBin(n.sent[0]));
  assert.equal(tx.locktime, 960000); assert.equal(binToHex(tx.outputs[0].lockingBytecode), binToHex(chain.locks.requested)); assert.equal(r.path, 'A3');
  n = net({ coins: coins(99999n) }); await bad(settlePact({ pact, path: 'A1', key: kV, mgr: mgr(), provider: n.p }), /exactly one output of 100000/); assert.equal(n.sent.length, 0);
  n = net({ coins: {} }); await bad(settlePact({ pact, path: 'A1', key: kV, mgr: mgr(), provider: n.p }), /found 0/); assert.equal(n.sent.length, 0);
  n = net({ coins: coins(100000n) }); await assert.rejects(settlePact({ pact, path: 'A1', key: kW, mgr: mgr(), provider: n.p })); assert.equal(n.sent.length, 0);
  await bad(settlePact({ pact, path: 'A4', key: kV, mgr: mgr(), provider: n.p }), /not available/);
});

test('settle (claim stage): C1 collect needs 432 confirmations and sets the relative lock; C3 (V) and C4 (W) need none; refusals broadcast nothing', async () => {
  const req = (sat = 100000n) => ({ [chain.addresses.requested]: [{ txid: T(73), vout: 0, satoshis: sat }], [walletAddr('receive', 3)]: [{ txid: T(22), vout: 1, satoshis: 30000n }] });
  let n = net({ coins: req() }); n.p.confirmationsOf = async () => 431;
  await bad(settlePact({ pact, path: 'C1', key: kW, mgr: mgr(), provider: n.p }), /Not yet/); assert.equal(n.sent.length, 0);
  n = net({ coins: req() }); n.p.confirmationsOf = async () => 432;
  const r = await settlePact({ pact, path: 'C1', key: kW, mgr: mgr(), provider: n.p });
  let tx = decodeTransactionBch(hexToBin(n.sent[0]));
  assert.equal(r.path, 'C1'); assert.equal(tx.inputs[0].sequenceNumber, 432); // block-based relative lock of 432
  assert.equal(tx.outputs[0].valueSatoshis, 100000n); assert.equal(binToHex(tx.outputs[0].lockingBytecode), binToHex(pact.lockW));
  assert.equal(binToHex(tx.inputs[0].outpointTransactionHash), T(73));
  for (const [path, key, lock] of [['C3', kV, pact.lockW], ['C4', kW, pact.lockV]]) {
    n = net({ coins: req() });
    await settlePact({ pact, path, key, mgr: mgr(), provider: n.p });
    tx = decodeTransactionBch(hexToBin(n.sent[0]));
    assert.equal(tx.outputs[0].valueSatoshis, 100000n); assert.equal(binToHex(tx.outputs[0].lockingBytecode), binToHex(lock));
  }
  n = net({ coins: req(99999n) }); n.p.confirmationsOf = async () => 500; await bad(settlePact({ pact, path: 'C1', key: kW, mgr: mgr(), provider: n.p }), /exactly one output of 100000/); assert.equal(n.sent.length, 0);
  n = net({ coins: req() }); await assert.rejects(settlePact({ pact, path: 'C3', key: kW, mgr: mgr(), provider: n.p })); assert.equal(n.sent.length, 0); // W cannot sign the V path
});

test('settle: a stray payment at the stage address does not block the exit; two outputs of exactly F do', async () => {
  const stray = { txid: T(81), vout: 3, satoshis: 546n }, main = { txid: T(82), vout: 0, satoshis: 100000n }, fee = { [walletAddr('receive', 3)]: [{ txid: T(22), vout: 1, satoshis: 30000n }] };
  let n = net({ coins: { [chain.addresses.accepted]: [stray, main], ...fee } });
  const r = await settlePact({ pact, path: 'A1', key: kV, mgr: mgr(), provider: n.p });
  const tx = decodeTransactionBch(hexToBin(n.sent[0]));
  assert.equal(binToHex(tx.inputs[0].outpointTransactionHash), T(82), 'the exact-F output is spent, not the stray'); assert.equal(r.path, 'A1');
  n = net({ coins: { [chain.addresses.accepted]: [{ ...main, txid: T(83) }, main, stray], ...fee } });
  await bad(settlePact({ pact, path: 'A1', key: kV, mgr: mgr(), provider: n.p }), /found 2/); assert.equal(n.sent.length, 0);
  n = net({ coins: { [chain.addresses.accepted]: [{ ...main, token: { amount: 1n, category: T(9) } }], ...fee } });
  await bad(settlePact({ pact, path: 'A1', key: kV, mgr: mgr(), provider: n.p }), /found 0/); assert.equal(n.sent.length, 0, 'a token output of F is not pact money');
});

test('settle: unknown confirmation count (server omits it) does not block C1; the node rule is translated for the user', async () => {
  const req = { [chain.addresses.requested]: [{ txid: T(73), vout: 0, satoshis: 100000n }], [walletAddr('receive', 3)]: [{ txid: T(22), vout: 1, satoshis: 30000n }] };
  let n = net({ coins: req }); n.p.performRequest = async () => ({});   // no "confirmations" field
  await settlePact({ pact, path: 'C1', key: kW, mgr: mgr(), provider: n.p }); assert.equal(n.sent.length, 1);
  n = net({ coins: req, sendResult: () => { throw new Error('non-BIP68-final'); } }); n.p.performRequest = async () => ({});
  await bad(settlePact({ pact, path: 'C1', key: kW, mgr: mgr(), provider: n.p }), /Not yet.*waited long enough/);
  n = net({ coins: req }); n.p.performRequest = async () => ({ confirmations: 0 });
  await bad(settlePact({ pact, path: 'C1', key: kW, mgr: mgr(), provider: n.p }), /Not yet.*waited 0 so far/); assert.equal(n.sent.length, 0);
});

test('wallet that refuses or errors: plain message, nothing broadcast; prompt names the real payout address and strips markup from the name', async () => {
  const p1 = { ...pact, name: 'Show <b>"x"</b>' };
  let seen = null;
  const spy = { ...mgr(), signTransaction: async (req) => { seen = req; throw new Error('user rejected'); } };
  const n = net({ coins: { [chain.addresses.accepted]: [{ txid: T(82), vout: 0, satoshis: 100000n }], [walletAddr('receive', 3)]: [{ txid: T(22), vout: 1, satoshis: 30000n }] } });
  await bad(settlePact({ pact: p1, path: 'A1', key: kV, mgr: spy, provider: n.p }), /did not complete the request \(user rejected\)\. Nothing was sent/);
  assert.equal(n.sent.length, 0); assert.ok(seen);
  const { SETTLE_TEXT } = await import('../web/accept.js');
  const t = SETTLE_TEXT.A1(p1, 100000n);
  assert.ok(t.includes('bitcoincash:q') && !t.includes('<b>') && !t.includes('&'), 'real address, no markup');
});
