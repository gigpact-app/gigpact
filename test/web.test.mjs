// Web app helpers (web/pact.js): link codec, amount and address parsing. Pure functions, no browser, no network.
// Evidence level: unit tests only; the screens themselves were only looked at in a headless Chrome without network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { binToHex, hexToBin, lockingBytecodeToCashAddress, encodeLockingBytecodeP2pkh, hash160, secp256k1, encodeCashAddress, CashAddressType } from '@bitauth/libauth';

globalThis.location = { search: '' }; // config.js reads the URL; mainnet by default
const { parseBch, fmtBch, parseAddress, addressOf, encodePact, decodePact, cleanName, newKey, pubOf, lockOfPk, checkNumbers, UiError } = await import('../web/pact.js');

const mk = () => { const sk = newKey(), pk = pubOf(sk); return { pk, lock: lockOfPk(pk) }; };
const W = mk();
const base = { name: 'Friday set', F: 200000n, tEnd: 960000, pkW: W.pk, lockW: W.lock };
const bad = (fn, re) => assert.throws(fn, (e) => e instanceof UiError && (!re || re.test(e.message)));

test('amounts: exact BCH <-> sat conversion, no floating point', () => {
  assert.equal(parseBch('0.002'), 200000n);
  assert.equal(parseBch('1'), 100000000n);
  assert.equal(parseBch('0,00012345'), 12345n);
  assert.equal(parseBch('0.1') + parseBch('0.2'), parseBch('0.3'));
  for (const s of ['', 'abc', '-1', '1e3', '0.123456789', '1..2']) bad(() => parseBch(s));
  assert.equal(fmtBch(200000n), '0.002'); assert.equal(fmtBch(100000000n), '1'); assert.equal(fmtBch(12345n), '0.00012345');
});

test('addresses: only regular P2PKH of the right network; token-aware and wrong-network are refused', () => {
  const addr = addressOf(W.lock);
  assert.match(addr, /^bitcoincash:q/);
  assert.deepEqual(Array.from(parseAddress(addr)), Array.from(W.lock));
  assert.deepEqual(Array.from(parseAddress(addr.replace('bitcoincash:', ''))), Array.from(W.lock)); // prefix optional
  bad(() => parseAddress(''), /Enter/);
  bad(() => parseAddress('bitcoincash:qqqqqq'), /valid/);
  const test3 = lockingBytecodeToCashAddress({ bytecode: W.lock, prefix: 'bchtest' }).address;
  bad(() => parseAddress(test3), /mainnet/);
  const tokenAware = encodeCashAddress({ prefix: 'bitcoincash', type: CashAddressType.p2pkhWithTokens, payload: W.lock.slice(3, 23) });
  bad(() => parseAddress(typeof tokenAware === 'string' ? tokenAware : tokenAware.address), /regular wallet address/);
  const p2sh32 = lockingBytecodeToCashAddress({ bytecode: hexToBin('aa20' + '11'.repeat(32) + '87'), prefix: 'bitcoincash' }).address;
  bad(() => parseAddress(p2sh32), /regular wallet address/);
});

test('pact link: round trip, optional organizer part, names are cleaned', () => {
  const code = encodePact(base);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const d = decodePact(code);
  assert.equal(d.name, 'Friday set'); assert.equal(d.F, 200000n); assert.equal(d.tEnd, 960000);
  assert.equal(binToHex(d.pkW), binToHex(W.pk)); assert.equal(binToHex(d.lockW), binToHex(W.lock)); assert.equal(d.pkV, undefined);
  const V = mk();
  const full = decodePact(encodePact({ ...base, pkV: V.pk, lockV: V.lock }));
  assert.equal(binToHex(full.pkV), binToHex(V.pk)); assert.equal(binToHex(full.lockV), binToHex(V.lock));
  assert.equal(cleanName('  a\u0000b\nc  '), 'a b c');
  assert.equal(cleanName('x'.repeat(100)).length, 60);
});

test('pact link: damaged or hostile links are refused, never half-parsed', () => {
  const ok = JSON.parse(Buffer.from(encodePact(base), 'base64url').toString());
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  bad(() => decodePact('not base64 !!'), /damaged/);
  bad(() => decodePact(enc({ ...ok, v: 2 })), /different version/);
  bad(() => decodePact(enc({ ...ok, n: 'chipnet' })), /chipnet/);
  bad(() => decodePact(enc({ ...ok, F: '-5' })), /damaged/);
  bad(() => decodePact(enc({ ...ok, F: '1e9' })), /damaged/);
  bad(() => decodePact(enc({ ...ok, tEnd: 1.5 })), /damaged/);
  bad(() => decodePact(enc({ ...ok, tEnd: 600_000_000 })), /damaged/);
  bad(() => decodePact(enc({ ...ok, pkW: '04' + '00'.repeat(64) })), /damaged/);
  bad(() => decodePact(enc({ ...ok, lockW: 'aa' })), /damaged/);
  bad(() => decodePact(enc({ ...ok, name: '<img src=x onerror=alert(1)>\n' })), /damaged/); // control characters in a name are refused
  bad(() => decodePact(enc({ ...ok, pkV: ok.pkW })), /damaged/); // organizer part must be complete
  // markup in a name is plain text for the UI (it is only ever set with textContent); the codec keeps it as typed
  assert.equal(decodePact(enc({ ...ok, name: '<b>hi</b>' })).name, '<b>hi</b>');
});

test('numbers: the library rules apply before a link is ever made (fee floor, K12)', () => {
  assert.doesNotThrow(() => checkNumbers(base));
  assert.throws(() => checkNumbers({ ...base, F: 7999n }), /fA must be <= F\/4|F - fA|F\/2/);
  assert.throws(() => checkNumbers({ ...base, F: 0n }));
});
