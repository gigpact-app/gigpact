// G2 R-VM harness. Evidence level: R-VM only (libauth BCH VM via CashScript TransactionBuilder.debug()).
// No node, no network, no wallet. Builds Funded -> Accepted -> Requested -> Dispute as the tx library will (I12).
import { readFileSync, writeFileSync } from 'node:fs';
import { Contract, MockNetworkProvider, SignatureTemplate, TransactionBuilder, SighashType, randomUtxo, randomToken } from 'cashscript';
import { hash160, encodeLockingBytecodeP2pkh, cashAddressToLockingBytecode, binToHex, hexToBin, decodeTransactionBch, createVirtualMachineBch2026, createVirtualMachineBch2025 } from '@bitauth/libauth';
import { randomNFT } from 'cashscript';

const root = new URL('..', import.meta.url);
export const art = (n) => JSON.parse(readFileSync(new URL(`artifacts/${n}.json`, root)));
export const src = (n) => readFileSync(new URL(`contracts/${n}.cash`, root), 'utf8').split('\n');
export const VM_TARGET = process.env.VM_TARGET || 'BCH_2026_05'; // default: CashScript 0.14.0 default VM target
export const provider = new MockNetworkProvider({ vmTarget: VM_TARGET });

const key = (b) => Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? b : 0));
export const keys = { V: key(1), W: key(2), A: key(3), S: key(4), X: key(5) };
export const SH = {
  H61: SighashType.SIGHASH_ALL | SighashType.SIGHASH_UTXOS,                                   // 0x61
  H41: SighashType.SIGHASH_ALL,                                                                // 0x41 (FORKID implied)
  HC1: SighashType.SIGHASH_ALL | SighashType.SIGHASH_ANYONECANPAY,                             // 0xC1
};
export const tpl = (k, st) => new SignatureTemplate(k, st);
const pk = (k) => tpl(k).publicKey;
const p2pkh = (k) => encodeLockingBytecodeP2pkh(hash160(pk(k)));
export const locks = { V: p2pkh(keys.V), W: p2pkh(keys.W), A: p2pkh(keys.A), S: p2pkh(keys.S), X: p2pkh(keys.X) };
export const lockOf = (c) => cashAddressToLockingBytecode(c.address).bytecode;

export const P = { Fa: 100000n, fA: 2000n, dust: 1000n, tEnd: 800000n, tA4: 800000n + 1008n, dv: 432n, l: 2016n };

export function chain(over = {}) {
  const p = { ...P, ...over };
  const mk = (name, args) => new Contract(art(name), args, { provider });
  const base = [pk(keys.V), pk(keys.W)];
  const dispute = (phi) => mk('GigPactDispute', [...base, pk(keys.A), locks.V, locks.W, locks.A, BigInt(phi), p.fA, p.l, p.dust]);
  const d100 = dispute(100), d50 = dispute(50);
  const requested = mk('GigPactRequested', [...base, locks.V, locks.W, lockOf(over.disputePay ?? d100), p.dv, p.dust]);
  const accepted = mk('GigPactAccepted', [...base, locks.V, locks.W, lockOf(requested), lockOf(over.refund ?? d50), p.tEnd, p.tA4, p.dust]);
  const funded = mk('GigPactFunded', [pk(keys.V), pk(keys.W), locks.V, lockOf(over.acc ?? accepted), p.Fa, p.fA, p.dust]);
  return { p, funded, accepted, requested, d100, d50, dispute };
}

export function lineIn(cname, fn, re, opts = {}) {
  const L = src(cname); let i = L.findIndex((l) => l.includes(`function ${fn}(`)); if (i < 0) throw new Error('no fn ' + fn);
  let end = L.findIndex((l, k) => k > i && l.includes('function ')); if (end < 0) end = L.length;
  if (opts.after) { const j = L.findIndex((l, k) => k > i && k < end && l.includes(opts.after)); if (j < 0) throw new Error('no after ' + opts.after); i = j; }
  const k = L.findIndex((l, n) => n > i && n < end && re.test(l)); if (k < 0) throw new Error(`no match ${re} in ${fn}`);
  return k + 1;
}

export const results = [];
process.on('exit', () => { try { writeFileSync(new URL('test/results.json', root), JSON.stringify(results, null, 1)); } catch {} });

// spec: {contract, cname, fn, args, value, outs, sponsors, seq, locktime, order, contractIdx, sponsorTokenIdx}
export function run(spec) {
  const { contract, fn, args = [], value, outs, sponsors = [20000n], seq, locktime } = spec;
  const cu = { ...randomUtxo({ satoshis: value }), lockingBytecode: binToHex(lockOf(contract)) };
  if (spec.contractToken) cu.token = spec.contractToken;
  const b = new TransactionBuilder({ provider, maximumFeeSatoshis: 1000000000n, allowImplicitFungibleTokenBurn: true });
  const contractIn = [cu, contract.unlock[fn](...args), seq !== undefined ? { sequence: Number(seq) } : undefined];
  const spons = sponsors.map((s, i) => {
    const u = { ...randomUtxo({ satoshis: s }), lockingBytecode: binToHex(locks.S) };
    if (spec.sponsorTokenIdx === i) u.token = spec.sponsorToken ?? randomToken({ amount: 5n });
    return [u, tpl(keys.S, spec.sponsorHash).unlockP2PKH()];
  });
  const all = spec.contractIdx ? [...spons.slice(0, spec.contractIdx), contractIn, ...spons.slice(spec.contractIdx)] : [contractIn, ...spons];
  for (const [u, unl, o] of all) b.addInput(u, unl, o);
  for (const o of outs) b.addOutput({ to: o.to, amount: o.amount, token: o.token });
  if (locktime !== undefined) b.setLocktime(Number(locktime));
  if (spec.version !== undefined) return evalRaw(b, all, spec.version);
  try { b.debug(); return { ok: true }; }
  catch (e) { return classify(e); }
}

function classify(e) {
  const m = String(e.message ?? e).split('\n')[0];
  const mm = m.match(/\.cash:(\d+) (?:Require|Error)/);
  // 'vm' = rejected by script evaluation in the libauth VM; 'builder' = rejected by CashScript/SDK before evaluation
  return { ok: false, err: m, line: mm ? Number(mm[1]) : undefined, kind: /at input \d+ in contract/.test(m) ? 'vm' : 'builder' };
}

// Evaluate input 0 in the VM with a modified tx version (CSV needs version >= 2). Only for paths where input 0 needs no signature.
function evalRaw(b, all, version) {
  const tx = decodeTransactionBch(hexToBin(b.build()));
  if (typeof tx === 'string') throw new Error(tx);
  tx.version = version;
  const sourceOutputs = all.map(([u]) => ({ lockingBytecode: hexToBin(u.lockingBytecode), valueSatoshis: u.satoshis, ...(u.token ? { token: { amount: u.token.amount, category: hexToBin(u.token.category), nft: u.token.nft ? { capability: u.token.nft.capability, commitment: hexToBin(u.token.nft.commitment) } : undefined } } : {}) }));
  const vm = VM_TARGET === 'BCH_2025_05' ? createVirtualMachineBch2025() : createVirtualMachineBch2026();
  const r = vm.verify({ inputIndex: 0, sourceOutputs, transaction: tx });
  return r === true ? { ok: true } : { ok: false, err: String(r), kind: 'vm' };
}
