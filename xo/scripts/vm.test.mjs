// Offline VM test of the pact redeem script (same logic as pact.template.mjs `pactRedeemScript`), BCH 2026 VM, P2SH32.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Opcodes, encodeDataPush, bigIntToVmNumber, sha256, secp256k1, hash160, encodeLockingBytecodeP2pkh, encodeLockingBytecodeP2sh32, hash256,
  generateSigningSerializationBch, createVirtualMachineBch2026, encodeTransactionBch, binToHex } from '@bitauth/libauth';
const O = Opcodes, op = (...x) => Uint8Array.from(x), cat = (...a) => Uint8Array.from(a.flatMap((x) => [...x]));
const key = (n) => sha256.hash(Uint8Array.of(n, 7, 7)); const pub = (k) => secp256k1.derivePublicKeyCompressed(k);
const kO = key(1), kW = key(2); const lockW = encodeLockingBytecodeP2pkh(hash160(pub(key(3)))), lockO = encodeLockingBytecodeP2pkh(hash160(pub(key(4)))), lockX = encodeLockingBytecodeP2pkh(hash160(pub(key(5))));
const END = 1000;
const redeem = cat(
  op(O.OP_DUP, O.OP_0, O.OP_NUMEQUAL, O.OP_IF, O.OP_DROP, O.OP_0, O.OP_OUTPUTBYTECODE), encodeDataPush(lockW), op(O.OP_EQUALVERIFY), encodeDataPush(pub(kO)), op(O.OP_CHECKSIG),
  op(O.OP_ELSE, O.OP_1, O.OP_NUMEQUAL, O.OP_IF, O.OP_0, O.OP_OUTPUTBYTECODE), encodeDataPush(lockO), op(O.OP_EQUALVERIFY), encodeDataPush(pub(kW)), op(O.OP_CHECKSIG),
  op(O.OP_ELSE), encodeDataPush(bigIntToVmNumber(BigInt(END))), op(O.OP_CHECKLOCKTIMEVERIFY, O.OP_DROP, O.OP_0, O.OP_OUTPUTBYTECODE), encodeDataPush(lockW), op(O.OP_EQUALVERIFY), encodeDataPush(pub(kW)), op(O.OP_CHECKSIG, O.OP_ENDIF, O.OP_ENDIF));
const pactLock = encodeLockingBytecodeP2sh32(hash256(redeem));
const vm = createVirtualMachineBch2026();
function run({ signer, sel, outLock, locktime = 0, seq = 0xffffffff, sh = 0x41 }) {
  const sourceOutputs = [{ lockingBytecode: pactLock, valueSatoshis: 100000n }];
  const tx = { version: 2, locktime, inputs: [{ outpointTransactionHash: new Uint8Array(32).fill(9), outpointIndex: 0, sequenceNumber: seq, unlockingBytecode: new Uint8Array() }], outputs: [{ lockingBytecode: outLock, valueSatoshis: 99000n }] };
  const ser = generateSigningSerializationBch({ inputIndex: 0, sourceOutputs, transaction: tx }, { coveredBytecode: redeem, signingSerializationType: Uint8Array.of(sh) });
  const sig = secp256k1.signMessageHashSchnorr(signer, sha256.hash(sha256.hash(ser)));
  tx.inputs[0].unlockingBytecode = cat(encodeDataPush(Uint8Array.from([...sig, sh])), sel === 0 ? op(O.OP_0) : sel === 1 ? op(O.OP_1) : op(O.OP_2), encodeDataPush(redeem));
  return vm.verify({ sourceOutputs, transaction: tx });
}
const ok = (r) => assert.equal(typeof r, 'string' ? 'object' : 'object') || r;
const pass = (r) => assert.ok(typeof r !== 'string', String(r));
const fail = (r) => assert.equal(typeof r, 'string');
test('pay: organizer signature, output to the worker', () => pass(run({ signer: kO, sel: 0, outLock: lockW })));
test('pay: output to anywhere else is refused', () => fail(run({ signer: kO, sel: 0, outLock: lockX })));
test('pay: worker key cannot use the pay path', () => fail(run({ signer: kW, sel: 0, outLock: lockW })));
test('waive: worker signature, output to the organizer refund', () => pass(run({ signer: kW, sel: 1, outLock: lockO })));
test('waive: output to the worker is refused (no early grab)', () => fail(run({ signer: kW, sel: 1, outLock: lockW })));
test('waive: organizer key cannot use the waive path', () => fail(run({ signer: kO, sel: 1, outLock: lockO })));
test('claim: before the event end is refused', () => fail(run({ signer: kW, sel: 2, outLock: lockW, locktime: END - 1, seq: 0 })));
test('claim: after the event end, worker to worker payout', () => pass(run({ signer: kW, sel: 2, outLock: lockW, locktime: END, seq: 0 })));
test('claim: after the event end, other destination refused', () => fail(run({ signer: kW, sel: 2, outLock: lockX, locktime: END, seq: 0 })));
test('claim: organizer key cannot claim', () => fail(run({ signer: kO, sel: 2, outLock: lockW, locktime: END, seq: 0 })));
test('claim: final sequence number disables locktime, refused', () => fail(run({ signer: kW, sel: 2, outLock: lockW, locktime: END, seq: 0xffffffff })));
test('redeem bytes (hand assembled) printed', () => console.log('HAND', binToHex(redeem)));
