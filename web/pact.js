// Pure helpers for the pact link, keys and addresses. No DOM here.
import { secp256k1, hash160, sha256, encodeLockingBytecodeP2pkh, decodeCashAddress, lockingBytecodeToCashAddress, cashAddressToLockingBytecode, binToHex, hexToBin } from '@bitauth/libauth';
import { buildChain, normalize } from '../src/chain.mjs';
import { FA, ARBITER_PK, NET, PREFIX } from './config.js';

export class UiError extends Error { constructor(m) { super(m); this.name = 'UiError'; } }
const need = (c, m) => { if (!c) throw new UiError(m); };

export const newKey = () => { let k; do { k = crypto.getRandomValues(new Uint8Array(32)); } while (!secp256k1.validatePrivateKey(k)); return k; };
export const pubOf = (k) => secp256k1.derivePublicKeyCompressed(k);
export const lockOfPk = (pk) => encodeLockingBytecodeP2pkh(hash160(pk));
export const ARBITER = { pk: hexToBin(ARBITER_PK), lock: lockOfPk(hexToBin(ARBITER_PK)) };

// Regular (P2PKH) Bitcoin Cash address of the right network. Token-aware addresses are refused on purpose.
export function parseAddress(text) {
  const s = String(text).trim();
  need(s.length > 0, 'Enter a Bitcoin Cash address.');
  const full = s.includes(':') ? s : `${PREFIX}:${s}`;
  const d = decodeCashAddress(full);
  need(typeof d === 'object', 'That does not look like a valid Bitcoin Cash address.');
  need(d.prefix === PREFIX, `This app is on ${NET}. Use an address that starts with "${PREFIX}:".`);
  need(d.type === 'p2pkh', 'Use a regular wallet address (it starts with "q"), not a token-aware or script address.');
  const r = cashAddressToLockingBytecode(full);
  need(typeof r === 'object', 'That does not look like a valid Bitcoin Cash address.');
  return r.bytecode;
}
export const addressOf = (lock) => lockingBytecodeToCashAddress({ bytecode: lock, prefix: PREFIX }).address;

// "0.0015" -> 150000n sat (exact, no floating point)
export function parseBch(text) {
  const s = String(text).trim().replace(',', '.');
  need(/^\d+(\.\d{1,8})?$/.test(s), 'Enter the fee as a number of BCH, for example 0.002.');
  const [w, f = ''] = s.split('.');
  return BigInt(w) * 100_000_000n + BigInt((f + '00000000').slice(0, 8));
}
export function fmtBch(sat) {
  const w = sat / 100_000_000n, f = (sat % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return f ? `${w}.${f}` : `${w}`;
}

// ---- pact link: worker request (r) and organizer reply (p = r + V data) ---------------------------------
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const HEX33 = /^0[23][0-9a-f]{64}$/, HEXLOCK = /^[0-9a-f]{50}$/; // 33-byte key; 25-byte P2PKH lock
export const cleanName = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);

export function encodePact(o) {
  const body = { v: 1, n: NET, name: cleanName(o.name), F: o.F.toString(), tEnd: o.tEnd, pkW: binToHex(o.pkW), lockW: binToHex(o.lockW) };
  if (o.pkV) { body.pkV = binToHex(o.pkV); body.lockV = binToHex(o.lockV); }
  return b64u(new TextEncoder().encode(JSON.stringify(body)));
}
export function decodePact(code) {
  let o;
  try { o = JSON.parse(new TextDecoder().decode(unb64u(String(code)))); } catch { throw new UiError('This pact link is damaged. Ask for a new one.'); }
  need(o && typeof o === 'object' && o.v === 1, 'This pact link is from a different version of the app.');
  need(o.n === NET, `This pact is for ${o.n}, but the app is on ${NET}.`);
  need(typeof o.name === 'string' && o.name.length <= 60 && cleanName(o.name) === o.name, 'This pact link is damaged.');
  need(/^\d{1,16}$/.test(String(o.F)) && Number.isInteger(o.tEnd) && o.tEnd > 0 && o.tEnd < 500_000_000, 'This pact link is damaged.');
  need(HEX33.test(o.pkW) && HEXLOCK.test(o.lockW), 'This pact link is damaged.');
  const out = { name: o.name, F: BigInt(o.F), tEnd: o.tEnd, pkW: hexToBin(o.pkW), lockW: hexToBin(o.lockW) };
  if (o.pkV !== undefined || o.lockV !== undefined) { need(HEX33.test(o.pkV) && HEXLOCK.test(o.lockV), 'This pact link is damaged.'); out.pkV = hexToBin(o.pkV); out.lockV = hexToBin(o.lockV); }
  return out;
}
export const pactId = (code) => binToHex(sha256.hash(new TextEncoder().encode(String(code)))).slice(0, 16);

// The chain for a complete pact (V and W known). Throws the library's own ParamError if the numbers are not allowed.
export function chainFor(p, provider) {
  need(p.pkV && p.lockV, 'Organizer details are missing.');
  return buildChain({ pk: { V: p.pkV, W: p.pkW, A: ARBITER.pk }, lock: { V: p.lockV, W: p.lockW, A: ARBITER.lock }, F: p.F, fA: FA, tEnd: BigInt(p.tEnd) }, { provider });
}
// Early check on the worker's side (V not known yet): same numeric rules, with W standing in for V.
export function checkNumbers(p) {
  return normalize({ pk: { V: p.pkW, W: p.pkW, A: ARBITER.pk }, lock: { V: p.lockW, W: p.lockW, A: ARBITER.lock }, F: p.F, fA: FA, tEnd: BigInt(p.tEnd) });
}
