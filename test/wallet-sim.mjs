// Software stand-in for a WizardConnect wallet, used ONLY in tests. Evidence level: it proves our request/verify code
// against the documented protocol, NOT that any real wallet behaves this way (Paytaca/Selene need their own runs).
// It sees only what a real wallet would see: the JSON string of the request. It signs the inputs named in inputPaths
// with SIGHASH 0x61 and leaves every other input alone, exactly as the WizardConnect docs describe.
import { binToHex, hexToBin, sha256, secp256k1, decodeTransactionBch, encodeTransactionBch, encodeDataPush, generateSigningSerializationBch, utf8ToBin } from '@bitauth/libauth';
import { toUint8Array, toBigInt } from '@wizardconnect/core';

export const walletKey = (name, i) => {
  const k = sha256.hash(utf8ToBin(`gigpact-test-wallet|${name}|${i}`));
  if (!secp256k1.validatePrivateKey(k)) throw new Error('bad test key');
  return k;
};
export const walletPub = (name, i) => secp256k1.derivePublicKeyCompressed(walletKey(name, i));
// derive(pathName, index) as the app would get it from the connection manager
export const derive = (name, i) => walletPub(name, i);

// opts: sighash (default 0x61), keyFor(name,i) override, mutate(tx) after signing, error (string) to refuse, skip (don't sign)
export function simWallet(requestJson, opts = {}) {
  if (opts.error) return { sequence: 1, signedTransaction: '', error: opts.error };
  const req = JSON.parse(requestJson);
  const tx = decodeTransactionBch(hexToBin(req.transaction.transaction));
  if (typeof tx === 'string') throw new Error('wallet: bad tx ' + tx);
  const sourceOutputs = req.transaction.sourceOutputs.map((s) => ({ lockingBytecode: toUint8Array(s.lockingBytecode), valueSatoshis: toBigInt(s.valueSatoshis) }));
  const sh = opts.sighash ?? 0x61;
  if (!opts.skip) {
    for (const [idx, name, i] of req.inputPaths) {
      const priv = (opts.keyFor ?? walletKey)(name, i);
      const ser = generateSigningSerializationBch({ inputIndex: idx, sourceOutputs, transaction: tx }, { coveredBytecode: sourceOutputs[idx].lockingBytecode, signingSerializationType: Uint8Array.of(sh) });
      const digest = sha256.hash(sha256.hash(ser));
      const sig = secp256k1.signMessageHashSchnorr(priv, digest);
      if (typeof sig === 'string') throw new Error('wallet sign: ' + sig);
      const pub = secp256k1.derivePublicKeyCompressed(priv);
      tx.inputs[idx] = { ...tx.inputs[idx], unlockingBytecode: Uint8Array.from([...encodeDataPush(Uint8Array.from([...sig, sh])), ...encodeDataPush(pub)]) };
    }
  }
  if (opts.mutate) opts.mutate(tx);
  return { sequence: 1, signedTransaction: binToHex(encodeTransactionBch(tx)) };
}
