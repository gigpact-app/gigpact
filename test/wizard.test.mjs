// G4-a: WizardConnect request builder + signed-transaction verifier, all 16 paths, with a SOFTWARE wallet.
// Evidence level: R-VM (libauth) + protocol-shape tests. Not regtest, not a real wallet, not mainnet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignatureTemplate } from 'cashscript';
import { binToHex, hexToBin, decodeTransactionBch, encodeTransactionBch, encodeLockingBytecodeP2pkh, hash160, sha256 } from '@bitauth/libauth';
import { toBigInt, toUint8Array } from '@wizardconnect/core';
import { provider, keys, tpl, locks } from './harness.mjs';
import { buildChain } from '../src/chain.mjs';
import { PATHS, PATH_IDS, planSpend } from '../src/spend.mjs';
import { declareFunding, newJob } from '../src/k17.mjs';
import { SpendError } from '../src/errors.mjs';
import { prepareSign, verifySigned, findSponsorPath, requestToJson } from '../src/wizard.mjs';
import { simWallet, derive, walletKey } from './wallet-sim.mjs';

const pk = (k) => tpl(k).publicKey;
const C = buildChain({ pk: { V: pk(keys.V), W: pk(keys.W), A: pk(keys.A) }, lock: { V: locks.V, W: locks.W, A: locks.A }, F: 100000n, fA: 2000n, tEnd: 800000n }, { provider });
const roleKeys = { V: keys.V, W: keys.W, A: keys.A };
const lockOfWallet = (name, i) => encodeLockingBytecodeP2pkh(hash160(derive(name, i)));
let n = 0;
const fake = (sats) => { n += 1; return { txid: 'cd'.repeat(30) + n.toString(16).padStart(4, '0'), vout: n % 3, satoshis: sats }; };
const at = (key, sats) => ({ ...fake(sats), lockingBytecode: Uint8Array.from(C.locks[key]) });
const spon = (sats, name = 'receive', i = 3) => ({ ...fake(sats), lockingBytecode: lockOfWallet(name, i) });
const code = (fn, c) => assert.throws(fn, (e) => e instanceof SpendError && e.code === c, `expected ${c}`);
const change = lockOfWallet('change', 0);

function prep(id, { phi = 100, sponsors = [spon(30000n)], paths = [['receive', 3]] } = {}) {
  const ck = PATHS[id].c.includes('|') ? (phi === 100 ? 'd100' : 'd50') : PATHS[id].c;
  const u0 = at(ck, id === 'D3' ? 100001n : 100000n);
  const plan = planSpend({ chain: C, path: id, utxo: u0, sponsors, ctx: { phi, dryRun: true }, job: id === 'F1' ? declareFunding(newJob(C), u0) : undefined });
  return prepareSign(plan, { provider, keys: roleKeys, SignatureTemplate, changeLock: change, sponsorPaths: paths });
}

for (const id of PATH_IDS) for (const phi of (['D4', 'D5', 'D6'].includes(id) ? [100, 50] : [100])) {
  test(`${id}${['D4', 'D5', 'D6'].includes(id) ? ` (phi=${phi})` : ''}: request is sparse and JSON-safe; software wallet signs; verifySigned accepts`, () => {
    const { request, expected } = prep(id, { phi });
    const json = requestToJson(request);               // the relay only does JSON.stringify
    const back = JSON.parse(json);
    assert.deepEqual(back.inputPaths, [[1, 'receive', 3]], 'only the sponsor input is listed (sparse inputPaths)');
    const so = back.transaction.sourceOutputs;
    assert.equal(so.length, 2);
    assert.ok(toUint8Array(so[0].unlockingBytecode).length > 0, 'contract input arrives with its complete unlocking bytecode');
    assert.equal(so[1].unlockingBytecode, '', 'sponsor input arrives empty');
    assert.equal(toBigInt(so[0].valueSatoshis), expected.plan.input0.satoshis, 'the wallet-side parser reads the amounts back');
    assert.equal(typeof back.transaction.transaction, 'string');
    const res = simWallet(json);
    const ok = verifySigned(expected, res, { derive });
    assert.match(ok.txid, /^[0-9a-f]{64}$/);
    assert.equal(ok.txid, binToHex(sha256.hash(sha256.hash(hexToBin(ok.hex))).reverse()), 'txid = reversed double-SHA256 of the signed bytes');
    assert.equal(ok.size, expected.size);
    assert.ok(ok.fee >= BigInt(ok.size));
    // the wallet signed ONLY input 1; the contract script in the answer is byte-identical to what we sent
    const tx = decodeTransactionBch(hexToBin(ok.hex));
    assert.equal(binToHex(tx.inputs[0].unlockingBytecode), binToHex(expected.contractUnlock));
  });
}

test('two sponsors on different wallet paths: both listed, both signed, accepted', () => {
  const { request, expected } = prep('A1', { sponsors: [spon(15000n, 'receive', 5), spon(15000n, 'change', 2)], paths: [['receive', 5], ['change', 2]] });
  assert.deepEqual(request.inputPaths, [[1, 'receive', 5], [2, 'change', 2]]);
  verifySigned(expected, simWallet(requestToJson(request)), { derive });
});

test('findSponsorPath: finds the right path/index; unknown address, non-P2PKH and bad names are refused before sending', () => {
  assert.deepEqual(findSponsorPath(lockOfWallet('change', 7), derive), ['change', 7]);
  assert.deepEqual(findSponsorPath(lockOfWallet('defi', 0), derive), ['defi', 0]);
  code(() => findSponsorPath(locks.X, derive), 'SponsorNotInWallet');
  code(() => findSponsorPath(lockOfWallet('receive', 80), derive), 'SponsorNotInWallet'); // beyond the search window
  code(() => findSponsorPath(Uint8Array.from(C.locks.funded), derive), 'SponsorNotP2pkh');
  code(() => findSponsorPath(lockOfWallet('receive', 1), derive, { names: ['stealth_scan'] }), 'BadPathName');
});

test('prepareSign input checks: path list must match the sponsors; path names and indexes are validated', () => {
  const u0 = at('accepted', 100000n);
  const plan = planSpend({ chain: C, path: 'A1', utxo: u0, sponsors: [spon(30000n)], ctx: { dryRun: true } });
  const o = { provider, keys: roleKeys, SignatureTemplate, changeLock: change };
  code(() => prepareSign(plan, { ...o, sponsorPaths: [] }), 'SponsorPaths');
  code(() => prepareSign(plan, { ...o, sponsorPaths: [['receive', 1], ['receive', 2]] }), 'SponsorPaths');
  code(() => prepareSign(plan, { ...o, sponsorPaths: [['stealth_scan', 1]] }), 'SponsorPaths');
  code(() => prepareSign(plan, { ...o, sponsorPaths: [['receive', -1]] }), 'SponsorPaths');
  code(() => prepareSign(plan, { ...o, sponsorPaths: [['receive', 1.5]] }), 'SponsorPaths');
  const p2sh = planSpend({ chain: C, path: 'A1', utxo: at('accepted', 100000n), sponsors: [{ ...fake(30000n), lockingBytecode: Uint8Array.from([0xa9, 0x14, ...new Uint8Array(20), 0x87]) }], ctx: { dryRun: true } });
  code(() => prepareSign(p2sh, { ...o, sponsorPaths: [['receive', 1]] }), 'SponsorNotP2pkh');
});

// ---- the wallet is not trusted -----------------------------------------------------------------------
const bad = (label, opts, c, extra = {}) => test(`wallet misbehaviour refused: ${label} -> ${c}`, () => {
  const { request, expected } = prep('A1');
  const res = simWallet(requestToJson(request), opts);
  code(() => verifySigned(expected, res, { derive, ...extra }), c);
});
bad('wallet refuses (error field)', { error: 'User rejected' }, 'WalletRejected');
bad('wallet returns the transaction unsigned', { skip: true }, 'WalletScript');
bad('signs with 0x41 (no UTXOS commitment)', { sighash: 0x41 }, 'WalletSighash');
bad('signs with 0xc1 (ANYONECANPAY)', { sighash: 0xc1 }, 'WalletSighash');
bad('signs with a key from another path (address does not match)', { keyFor: (nm, i) => walletKey('change', 99) }, 'SponsorKeyMismatch');
bad('output amount changed after signing', { mutate: (tx) => { tx.outputs[0].valueSatoshis -= 1n; } }, 'WalletAltered');
bad('an extra output appended', { mutate: (tx) => { tx.outputs.push({ valueSatoshis: 546n, lockingBytecode: locks.X }); } }, 'WalletAltered');
bad('output 0 redirected to another lock', { mutate: (tx) => { tx.outputs[0].lockingBytecode = locks.X; } }, 'WalletAltered');
bad('locktime changed', { mutate: (tx) => { tx.locktime = 7; } }, 'WalletAltered');
bad('version changed', { mutate: (tx) => { tx.version = 1; } }, 'WalletAltered');
bad('contract input nSequence changed', { mutate: (tx) => { tx.inputs[0].sequenceNumber = 0xffffffff; } }, 'WalletAltered');
bad('contract unlocking script replaced', { mutate: (tx) => { tx.inputs[0].unlockingBytecode = Uint8Array.from([0x51]); } }, 'WalletAltered');
bad('extra input added', { mutate: (tx) => { tx.inputs.push({ ...tx.inputs[1], outpointIndex: 9 }); } }, 'WalletAltered');
bad('signature bit flipped (script check)', { mutate: (tx) => { const u = Uint8Array.from(tx.inputs[1].unlockingBytecode); u[10] ^= 1; tx.inputs[1].unlockingBytecode = u; } }, 'ScriptInvalid');
bad('a 71-byte DER-style script instead of Schnorr', { mutate: (tx) => { tx.inputs[1].unlockingBytecode = new Uint8Array(106).fill(1); } }, 'WalletScript');
bad('key at the wrong path/index when derive is pinned', { keyFor: (nm, i) => walletKey(nm, i + 1) }, 'SponsorKeyMismatch');

test('pinned path: a key that matches the sponsor address but is not the one named in inputPaths -> SponsorPathMismatch', () => {
  // the sponsor really sits at change/2, but we (wrongly) name receive/3; a wallet that signs with the right key anyway is caught when derive is pinned
  const { request, expected } = prep('A1', { sponsors: [spon(30000n, 'change', 2)], paths: [['receive', 3]] });
  const res = simWallet(requestToJson(request), { keyFor: () => walletKey('change', 2) });
  verifySigned(expected, res); // without derive the key matches the address, so it is accepted
  code(() => verifySigned(expected, res, { derive }), 'SponsorPathMismatch');
});

test('garbage answers are refused', () => {
  const { expected } = prep('A1');
  code(() => verifySigned(expected, null), 'WalletResponse');
  code(() => verifySigned(expected, { signedTransaction: '' }), 'WalletResponse');
  code(() => verifySigned(expected, { signedTransaction: 'zz' }), 'WalletResponse');
  code(() => verifySigned(expected, { signedTransaction: '0200' }), 'WalletResponse');
});

test('the contract signature does not depend on the sponsor script: signing afterwards leaves the role signature valid', () => {
  // direct proof of the design assumption: two wallets with different keys/addresses both yield a tx whose contract input passes
  for (const [nm, i] of [['receive', 0], ['change', 4], ['defi', 1]]) {
    const { request, expected } = prep('A1', { sponsors: [spon(30000n, nm, i)], paths: [[nm, i]] });
    verifySigned(expected, simWallet(requestToJson(request)), { derive });
  }
});
