// GigPact WizardConnect module: builds the sign request and checks what the wallet sends back.
//
// Design (Yol B, matches the WizardConnect docs read on 16 Nov 2026):
//   * The contract input is signed HERE with the role key (V / W / A) that lives in the browser. Its unlocking
//     bytecode is complete, so it needs no inputPaths entry (the wallet leaves inputs without an entry alone).
//   * The only input the wallet signs is the sponsor P2PKH input (fee + change). Its unlocking bytecode is empty in
//     the request; inputPaths is sparse: [[inputIndex, pathName, addressIndex], ...] for the sponsor inputs only.
//   * The role signature uses SIGHASH_ALL|FORKID|UTXOS (0x61). That preimage commits to outpoints, sequences,
//     outputs and every source output, but NOT to unlocking scripts, so filling in the sponsor script afterwards
//     does not invalidate it. Wallets MUST sign with 0x61 and reject other flags (WizardConnect rule).
//   * The wallet is not trusted: verifySigned() re-derives the transaction we asked for, and refuses anything that
//     differs by even one byte outside the sponsor unlocking scripts, then runs the full script check offline.
//
// Evidence level of this module: R-VM / regtest with a software "wallet". No real wallet has signed with it yet.
import { binToHex, hexToBin, hash160, sha256, decodeTransactionBch, encodeTransactionBch, encodeLockingBytecodeP2pkh, createVirtualMachineBch2026, hashTransactionUiOrder } from '@bitauth/libauth';
import { SpendError } from './errors.mjs';
import { buildTx, inspectTx, SIGHASH_61 } from './spend.mjs';

const need = (c, code, m) => { if (!c) throw new SpendError(code, m); };
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const bytesOf = (b) => (b instanceof Uint8Array ? b : hexToBin(b));

// WizardConnect hdwalletv1 well-known path names. Sponsor inputs may sit on any of them.
export const WC_PATHS = Object.freeze({ receive: 0, change: 1, defi: 7 });
export const SIGHASH_BYTE = 0x61;
export const P2PKH_UNLOCK_LEN = 100; // 0x41 <65-byte Schnorr sig + sighash byte> 0x21 <33-byte compressed pubkey>

const isP2pkh = (l) => l.length === 25 && l[0] === 0x76 && l[1] === 0xa9 && l[2] === 0x14 && l[23] === 0x88 && l[24] === 0xac;

// Relay-safe JSON form of a source output (same shape @wizardconnect/core's sourceOutputToRelay produces):
// bytes -> lowercase hex, bigint -> "<bigint: Nn>". The relay only does JSON.stringify, so the dapp must do this.
export function sourceOutputToRelay(so) {
  need(!so.token, 'WcToken', 'GigPact source outputs carry no tokens');
  return {
    outpointTransactionHash: binToHex(so.outpointTransactionHash), outpointIndex: so.outpointIndex,
    unlockingBytecode: binToHex(so.unlockingBytecode), sequenceNumber: so.sequenceNumber,
    valueSatoshis: `<bigint: ${so.valueSatoshis}n>`, lockingBytecode: binToHex(so.lockingBytecode),
  };
}

// Find which wallet path/index holds a sponsor P2PKH lock. derive(pathName, index) -> 33-byte pubkey | undefined
// (in the app: dapp.getPubkey(WC_PATHS[name], BigInt(index))). Throws if the wallet does not control the lock
// within the first `max` indexes, so a sponsor input the wallet cannot sign is caught BEFORE the request is sent.
export function findSponsorPath(lock, derive, { max = 50, names = Object.keys(WC_PATHS) } = {}) {
  const l = bytesOf(lock);
  need(isP2pkh(l), 'SponsorNotP2pkh', 'a wallet-signed sponsor input must be a plain P2PKH output');
  for (const name of names) {
    need(Object.hasOwn(WC_PATHS, name), 'BadPathName', `unknown path name ${String(name)}`);
    for (let i = 0; i < max; i++) {
      const pk = derive(name, i);
      if (pk && same(encodeLockingBytecodeP2pkh(hash160(pk)), l)) return [name, i];
    }
  }
  throw new SpendError('SponsorNotInWallet', `the connected wallet does not control this sponsor address (searched ${names.join('/')} up to index ${max - 1})`);
}

// A sponsor "unlocker" whose script is a 100-byte dummy of the exact final shape. It lets buildTx fit the fee for the
// size the wallet's real P2PKH script will have (Schnorr signatures are fixed width). It signs nothing; the dummy is
// blanked below before anything is sent, and no key is involved.
const dummyP2pkhUnlock = () => Uint8Array.from([0x41, ...new Uint8Array(65), 0x21, ...new Uint8Array(33)]);
// A plain custom unlocker (not cashscript's `placeholder` kind, which adds its own size allowance on top of real bytes).
const sponsorPlaceholder = () => ({ generateUnlockingBytecode: dummyP2pkhUnlock });

// plan: planSpend result. keys: role keys {V, W, A} (only the plan's signer is used). sponsorPaths: [[name, index], ...],
// one per sponsor in plan order (use findSponsorPath).
export function prepareSign(plan, { provider, keys, SignatureTemplate, changeLock, sponsorPaths, userPrompt }) {
  need(Array.isArray(sponsorPaths) && sponsorPaths.length === plan.sponsors.length, 'SponsorPaths', 'one [pathName, addressIndex] per sponsor input is required');
  sponsorPaths.forEach((sp, k) => {
    need(Array.isArray(sp) && sp.length === 2 && Object.hasOwn(WC_PATHS, sp[0]) && Number.isInteger(sp[1]) && sp[1] >= 0 && sp[1] <= 0x7fffffff, 'SponsorPaths', `sponsor ${k}: expected [receive|change|defi, non-negative integer]`);
    need(isP2pkh(bytesOf(plan.sponsors[k].lockingBytecode)), 'SponsorNotP2pkh', `sponsor ${k} must be a plain P2PKH output to be signed by a wallet`);
  });
  const built = buildTx(plan, { provider, keys, SignatureTemplate, changeLock, sponsorUnlock: sponsorPlaceholder });
  const tx = decodeTransactionBch(hexToBin(built.hex));
  need(typeof tx === 'object', 'BadTx', String(tx));
  const nIn = 1 + plan.sponsors.length;
  need(tx.inputs.length === nIn, 'PlanMismatch', 'input count differs from the plan');
  // keep the complete contract unlocking script, blank every sponsor script (the wallet fills those)
  const contractUnlock = Uint8Array.from(tx.inputs[0].unlockingBytecode);
  need(contractUnlock.length > 0, 'BadTx', 'contract input has no unlocking bytecode');
  for (let i = 1; i < nIn; i++) tx.inputs[i] = { ...tx.inputs[i], unlockingBytecode: new Uint8Array(0) };
  const unsignedHex = binToHex(encodeTransactionBch(tx));
  const srcs = [plan.input0, ...plan.sponsors];
  const sourceOutputs = tx.inputs.map((inp, i) => ({
    outpointTransactionHash: inp.outpointTransactionHash, outpointIndex: inp.outpointIndex, unlockingBytecode: inp.unlockingBytecode,
    sequenceNumber: inp.sequenceNumber, valueSatoshis: srcs[i].satoshis, lockingBytecode: Uint8Array.from(bytesOf(srcs[i].lockingBytecode)),
  }));
  const request = {
    transaction: { transaction: unsignedHex, sourceOutputs: sourceOutputs.map(sourceOutputToRelay), ...(userPrompt ? { userPrompt } : {}) },
    inputPaths: sponsorPaths.map(([name, index], k) => [1 + k, name, index]),
  };
  const expected = Object.freeze({
    plan, changeLock: Uint8Array.from(bytesOf(changeLock)), unsignedHex, sourceOutputs, size: built.size, fee: built.fee, change: built.change,
    hasChange: built.hasChange, sponsorPaths: sponsorPaths.map((sp) => [...sp]), contractUnlock,
  });
  return { request, expected };
}

// What a P2PKH unlocking script from a wallet must look like. Returns { sig, pubkey } or throws.
function parseP2pkhUnlock(u, k) {
  need(u.length === P2PKH_UNLOCK_LEN, 'WalletScript', `sponsor input ${k}: unlocking script is ${u.length} bytes, expected ${P2PKH_UNLOCK_LEN} (a 65-byte Schnorr signature and a 33-byte key)`);
  need(u[0] === 0x41 && u[66] === 0x21, 'WalletScript', `sponsor input ${k}: unlocking script is not <65-byte sig> <33-byte pubkey>`);
  const sig = u.slice(1, 66), pubkey = u.slice(67, 100);
  need(sig[64] === SIGHASH_BYTE, 'WalletSighash', `sponsor input ${k}: signature hash type is 0x${sig[64].toString(16)}, expected 0x61 (ALL|FORKID|UTXOS)`);
  return { sig, pubkey };
}

// Check the wallet's answer against what we asked for. response: { signedTransaction, error? } as in
// sign_transaction_response. derive is optional (same callback as findSponsorPath) and additionally pins each
// sponsor key to the exact path/index we named. Returns the verified hex and its txid; throws SpendError otherwise.
export function verifySigned(expected, response, { derive, vm = createVirtualMachineBch2026() } = {}) {
  need(response && typeof response === 'object', 'WalletResponse', 'no response object');
  need(!response.error, 'WalletRejected', `the wallet refused: ${String(response.error)}`);
  const hex = response.signedTransaction;
  need(typeof hex === 'string' && /^(?:[0-9a-fA-F]{2})+$/.test(hex), 'WalletResponse', 'signedTransaction is missing or not hex');
  const tx = decodeTransactionBch(hexToBin(hex));
  need(typeof tx === 'object', 'WalletResponse', `signedTransaction does not decode: ${String(tx)}`);
  const { plan } = expected;
  const nIn = 1 + plan.sponsors.length;
  need(tx.inputs.length === nIn, 'WalletAltered', 'the wallet changed the number of inputs');
  // 1. strip the sponsor scripts: the rest must equal our request byte for byte (outputs, order, version, locktime, sequences, contract script)
  const stripped = { ...tx, inputs: tx.inputs.map((inp, i) => (i === 0 ? inp : { ...inp, unlockingBytecode: new Uint8Array(0) })) };
  need(binToHex(encodeTransactionBch(stripped)) === expected.unsignedHex, 'WalletAltered', 'the signed transaction differs from the requested one outside the sponsor unlocking scripts');
  // 2. each sponsor script must be a well-formed P2PKH unlock with sighash 0x61 and a key that hashes to the lock
  for (let i = 1; i < nIn; i++) {
    const { pubkey } = parseP2pkhUnlock(tx.inputs[i].unlockingBytecode, i);
    const lock = bytesOf(plan.sponsors[i - 1].lockingBytecode);
    need(same(encodeLockingBytecodeP2pkh(hash160(pubkey)), lock), 'SponsorKeyMismatch', `sponsor input ${i}: the signing key does not match the sponsor address`);
    if (derive) {
      const [name, idx] = expected.sponsorPaths[i - 1], want = derive(name, idx);
      need(want && same(want, pubkey), 'SponsorPathMismatch', `sponsor input ${i}: the key is not the one at ${name}/${idx}`);
    }
  }
  // 3. full offline script check of every input (the role signature on the contract input AND the wallet's signatures)
  const sourceOutputs = expected.sourceOutputs.map((s) => ({ lockingBytecode: s.lockingBytecode, valueSatoshis: s.valueSatoshis }));
  for (let i = 0; i < nIn; i++) {
    const r = vm.verify({ inputIndex: i, transaction: tx, sourceOutputs });
    need(r === true, 'ScriptInvalid', `input ${i} fails script verification: ${String(r)}`);
  }
  // 4. accounting against the plan (fee, change, contract outputs) and the size we fitted the fee for
  const a = inspectTx(plan, hex, expected.changeLock);
  need(a.size === expected.size && a.fee === expected.fee, 'WalletAltered', `size/fee changed (${a.size} B / ${a.fee} sat, expected ${expected.size} B / ${expected.fee} sat)`);
  const txid = binToHex(hashTransactionUiOrder(hexToBin(hex)));
  return { hex: hex.toLowerCase(), txid, size: a.size, fee: a.fee, change: a.change };
}

// Parse a wallet-side view of the request exactly as a wallet would (JSON round trip + the package's own parsers).
// Used by the software wallet in the tests; exported so the UI "dry run" can show the user what the wallet will see.
export const requestToJson = (req) => JSON.stringify(req);
export { sha256, SIGHASH_61 };
