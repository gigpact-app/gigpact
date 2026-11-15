// GigPact transaction library, part 1: job parameters and the contract chain (I12).
// Builds Dispute -> Requested -> Accepted -> Funded bottom-up, because each state embeds the locking
// bytecode of the next one. The contracts do NOT cross-check these parameters (G1-03); this module
// is where I12 is enforced and verified.
import { readFileSync } from 'node:fs';
import { Contract, SignatureTemplate } from 'cashscript';
import { cashAddressToLockingBytecode, binToHex, secp256k1 } from '@bitauth/libauth';
import { strictBytes } from './errors.mjs';

export const BIP68_MAX_BLOCKS = 0xffffn; // largest block-based relative lock (low 16 bits of nSequence)
export const DEFAULTS = Object.freeze({ dv: 432n, l: 2016n, G: 1008n, dust: 1000n }); // blocks; G = 7 days
const ART = ['GigPactFunded', 'GigPactAccepted', 'GigPactRequested', 'GigPactDispute'];
const art = (n) => JSON.parse(readFileSync(new URL(`../artifacts/${n}.json`, import.meta.url)));
export const artifacts = () => Object.fromEntries(ART.map((n) => [n, art(n)]));

const hex = (b) => (typeof b === 'string' ? b : binToHex(b));
const bytes = (b) => { try { return strictBytes(b); } catch (e) { throw new ParamError(e.message); } };
export class ParamError extends Error { constructor(m) { super(m); this.name = 'ParamError'; } }
const need = (c, m) => { if (!c) throw new ParamError(m); };

// params: { pk:{V,W,A}, lock:{V,W,A}, F, fA, tEnd, dv?, l?, G?, dust? }  (pubkeys/locks: Uint8Array or hex)
export function normalize(p) {
  // only the known fields are kept: an unknown field in a parameter set is never carried along (and is caught by assertChain)
  const n = { dv: DEFAULTS.dv, l: DEFAULTS.l, G: DEFAULTS.G, dust: DEFAULTS.dust, F: p.F, fA: p.fA, tEnd: p.tEnd };
  for (const k of ['dv', 'l', 'G', 'dust']) if (p[k] !== undefined) n[k] = p[k];
  n.pk = {}; n.lock = {};
  for (const r of ['V', 'W', 'A']) {
    n.pk[r] = Uint8Array.from(bytes(p.pk?.[r] ?? '')); n.lock[r] = Uint8Array.from(bytes(p.lock?.[r] ?? '')); // copies: never alias caller memory
    need(n.pk[r].length === 33 && (n.pk[r][0] === 2 || n.pk[r][0] === 3), `pk${r} must be a 33-byte compressed public key`);
    need(secp256k1.validatePublicKey(n.pk[r]), `pk${r} is not a valid secp256k1 point`);
    need(n.lock[r].length > 0 && n.lock[r].length <= 100, `lock${r} must be a locking bytecode (1..100 bytes)`);
  }
  for (const k of ['F', 'fA', 'tEnd', 'dv', 'l', 'G', 'dust']) need(typeof n[k] === 'bigint' && n[k] > 0n, `${k} must be a positive bigint`);
  // BIP68 relative locks are block-based here: value in the low 16 bits only; disable flag (1<<31) and time-type flag (1<<22) stay clear
  for (const k of ['dv', 'l']) need(n[k] <= BIP68_MAX_BLOCKS, `${k} must be 1..${BIP68_MAX_BLOCKS} blocks (BIP68 16-bit relative lock, block-based)`);
  need(n.tEnd < 500_000_000n, 'tEnd must be a block height (< 500,000,000); unix-time locks are not used');
  need(n.tEnd + n.G < 500_000_000n, 'T_A4 must stay a block height');
  // K12 / 9.2 / 9.3 constraints (also enforced by Funded.accept; checked early so the UI never builds a dead job)
  need(n.fA >= n.dust, 'fA must be >= DUST_SAFE');
  need(4n * n.fA <= n.F, 'fA must be <= F/4 (K12)');
  need(n.F - n.fA >= 2n * n.dust, 'F - fA must be >= 2*DUST_SAFE');
  need(n.F / 2n >= n.dust, 'F/2 must be >= DUST_SAFE');
  n.tA4 = n.tEnd + n.G; // Alt-2: A4 only after T_end + G
  return n;
}

const lockOf = (c) => cashAddressToLockingBytecode(c.address).bytecode;

export function buildChain(params, { provider } = {}) {
  need(provider, 'provider required');
  const p = normalize(params);
  const a = artifacts();
  const mk = (name, args) => new Contract(a[name], args, { provider });
  const pk = [p.pk.V, p.pk.W];
  const dispute = (phi) => mk('GigPactDispute', [...pk, p.pk.A, p.lock.V, p.lock.W, p.lock.A, BigInt(phi), p.fA, p.l, p.dust]);
  const d100 = dispute(100), d50 = dispute(50);
  const requested = mk('GigPactRequested', [...pk, p.lock.V, p.lock.W, lockOf(d100), p.dv, p.dust]);
  const accepted = mk('GigPactAccepted', [...pk, p.lock.V, p.lock.W, lockOf(requested), lockOf(d50), p.tEnd, p.tA4, p.dust]);
  const funded = mk('GigPactFunded', [p.pk.V, p.pk.W, p.lock.V, lockOf(accepted), p.F, p.fA, p.dust]);
  const contracts = { funded, accepted, requested, d100, d50 };
  const locks = { V: p.lock.V, W: p.lock.W, A: p.lock.A, ...Object.fromEntries(Object.entries(contracts).map(([k, c]) => [k, lockOf(c)])) };
  return { params: p, contracts, locks, addresses: Object.fromEntries(Object.entries(contracts).map(([k, c]) => [k, c.address])) };
}

// I12: recompute the whole chain from the job parameters and compare with what was claimed
// (a job link, a stored record, or contracts built elsewhere). P2SH32 addresses commit to the full
// redeem bytecode, so address equality means every embedded parameter matches.
export function verifyChain(params, claimedAddresses, { provider }) {
  const expected = buildChain(params, { provider }).addresses;
  const mismatches = Object.keys(expected).filter((k) => claimedAddresses?.[k] !== expected[k]);
  return { ok: mismatches.length === 0, mismatches, expected };
}

// A chain object must be self-consistent AND everything the planner uses must come from a fresh rebuild:
// parameters (including the derived tA4), the five contract addresses, every lock (V/W/A and the five contract
// locks) and the contract objects themselves. Nothing is memoised: a chain object is mutable, so a one-time check
// would not protect later spends. Returns the freshly rebuilt chain; callers must use THAT object, not the claimed one.
export function assertChain(chain) {
  if (!chain?.params || !chain.addresses || !chain.locks || !chain.contracts?.funded?.provider) throw new ParamError('chain object is incomplete');
  const fresh = buildChain(chain.params, { provider: chain.contracts.funded.provider });
  if (canonParams(chain.params) !== canonParams(fresh.params)) throw new ParamError('chain parameters differ from the normalized parameters (I12)');
  const bad = [];
  for (const k of Object.keys(fresh.addresses)) {
    if (chain.addresses[k] !== fresh.addresses[k]) bad.push(`address.${k}`);
    if (chain.contracts[k]?.address !== fresh.addresses[k]) bad.push(`contract.${k}`);
  }
  for (const k of Object.keys(fresh.locks)) if (!chain.locks[k] || canonParams(bytes(chain.locks[k])) !== canonParams(fresh.locks[k])) bad.push(`lock.${k}`);
  if (Object.keys(chain.locks).length !== Object.keys(fresh.locks).length || Object.keys(chain.addresses).length !== Object.keys(fresh.addresses).length) bad.push('extra keys');
  if (bad.length) throw new ParamError(`chain inconsistent with its parameters (I12): ${bad.join(',')}`);
  return fresh;
}

// Canonical text of a parameter set (bigint / bytes safe), for exact comparison of two jobs or chains.
export function canonParams(p) {
  // type-tagged and key-sorted, so different shapes can never print the same text
  const norm = (v) => (typeof v === 'bigint' ? ['b', v.toString()] : v instanceof Uint8Array ? ['x', binToHex(v)] : Array.isArray(v) ? ['a', ...v.map(norm)]
    : v && typeof v === 'object' ? ['o', ...Object.keys(v).sort().map((k) => [k, norm(v[k])])] : ['p', typeof v, String(v)]);
  return JSON.stringify(norm(p));
}

// Deep copy of normalized parameters (bytes and bigint safe) so a stored job cannot be changed through a shared object.
export function cloneParams(p) {
  const f = (v) => (v instanceof Uint8Array ? Uint8Array.from(v) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, f(x)])) : v);
  return f(p);
}

export const keyTemplate = (key, sighash) => new SignatureTemplate(key, sighash);
export { lockOf, hex, bytes };
