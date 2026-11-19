// Rebuilds the pact link of an accepted pact from the chain alone. A spend of the pact's "accepted" contract (the A3 claim, for
// example) carries that contract's full script in its unlocking data, and that script holds both public keys, both payout locks
// and the end block. Usage: node scripts/recover-pact-link.mjs <txid of the claim> <F in sat> "<name>"
// Reads only; prints a link for the local app (http://127.0.0.1:4173). No key is read or written.
import { decodeTransactionBch, hexToBin, binToHex, decodeAuthenticationInstructions, bigIntToVmNumber, vmNumberToBigInt, hash160, hash256, encodeLockingBytecodeP2pkh, encodeLockingBytecodeP2sh32 } from '@bitauth/libauth';
import { buildChain } from '../src/chain.mjs';

const ARBITER_PK = '0397ea49320bea869b7c18ec5eff57e7bf4beb119c13534fad9250df19d065b05a', FA = 2000n; // same values as web/config.js (not imported: that file reads the browser's location)
const lockA = (A) => encodeLockingBytecodeP2pkh(hash160(A));

export function pushesOf(bytecode) {
  const out = [];
  for (const i of decodeAuthenticationInstructions(bytecode)) {
    if (i.malformed) break;
    if (i.data) out.push(i.data);
    else if (i.opcode === 0) out.push(new Uint8Array(0));
    else if (i.opcode >= 81 && i.opcode <= 96) out.push(bigIntToVmNumber(BigInt(i.opcode - 80)));
    else break;
  }
  return out;
}
const lastPush = (bytecode) => { const ins = decodeAuthenticationInstructions(bytecode).filter((i) => i.data && !i.malformed); return ins.length ? ins[ins.length - 1].data : null; };
const b64u = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sameB = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function recover(hex, F, name, Apk = ARBITER_PK) {
  const tx = decodeTransactionBch(hexToBin(hex)); if (typeof tx === 'string') throw new Error(tx);
  const A = hexToBin(Apk);
  for (const inp of tx.inputs) {
    const redeem = lastPush(inp.unlockingBytecode); if (!redeem || redeem.length < 100) continue;
    const items = pushesOf(redeem);
    const pks = items.filter((d) => d.length === 33 && (d[0] === 2 || d[0] === 3));
    const locks = items.filter((d) => d.length === 25 && d[0] === 0x76 && d[1] === 0xa9 && d[24] === 0xac);
    const nums = items.filter((d) => d.length <= 4).map((d) => vmNumberToBigInt(d)).filter((n) => typeof n === 'bigint');
    if (pks.length !== 2 || locks.length !== 2) continue;
    for (const tEnd of new Set(nums.filter((n) => n > 100000n && n < 100000000n))) for (const [pa, pb] of [[0, 1], [1, 0]]) for (const [la, lb] of [[0, 1], [1, 0]]) {
      const V = pks[pa], W = pks[pb], lV = locks[la], lW = locks[lb];
      let c; try { c = buildChain({ pk: { V, W, A }, lock: { V: lV, W: lW, A: lockA(A) }, F: BigInt(F), fA: FA, tEnd }, { provider: { network: 'mainnet' } }); } catch { continue; }
      if (sameB(encodeLockingBytecodeP2sh32(hash256(redeem)), c.locks.accepted)) {
        const body = { v: 1, n: 'mainnet', name, F: String(F), tEnd: Number(tEnd), pkW: binToHex(W), lockW: binToHex(lW), pkV: binToHex(V), lockV: binToHex(lV) };
        return { code: b64u(new TextEncoder().encode(JSON.stringify(body))), addresses: c.addresses, tEnd: Number(tEnd) };
      }
    }
  }
  return null;
}

if (process.argv[1]?.endsWith('recover-pact-link.mjs') && process.argv[2] && process.argv[2] !== '--test') {
  const [txid, F, name = 'Test 3 claim'] = process.argv.slice(2);
  const { ElectrumNetworkProvider } = await import('cashscript');
  const { failoverProvider } = await import('../web/failover.js');
  const provider = failoverProvider(['bch.imaginary.cash', 'bitcoincash.network'].map((hostname) => new ElectrumNetworkProvider('mainnet', { hostname })));
  const hex = await provider.performRequest('blockchain.transaction.get', txid);
  const r = recover(typeof hex === 'string' ? hex : hex.hex, F, name);
  if (!r) { console.log('NO MATCH: this transaction does not spend an accepted-stage address of this build.'); process.exit(1); }
  console.log(`end block ${r.tEnd}\nclaim-stage (requested) address ${r.addresses.requested}`);
  console.log(`\nLink:\nhttp://127.0.0.1:4173/#/pact/${r.code}\n`);
  process.exit(0);
}
