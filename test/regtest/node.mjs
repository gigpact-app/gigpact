// G3 regtest helper: starts a local BCHN node in regtest mode, talks JSON-RPC, mines blocks.
// Evidence level of anything built on this: REGTEST (real node consensus + policy), local, no wallet, no mainnet.
// The data directory lives OUTSIDE the project folder (the node deletes temp files there, which the connected-folder mount forbids).
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { lockingBytecodeToCashAddress } from '@bitauth/libauth';

const ROOT = new URL('../../', import.meta.url).pathname;
export const BITCOIND = process.env.BCHN_BIN || join(ROOT, 'tools/bchn/bin/bitcoind');
const RPC_PORT = Number(process.env.BCHN_RPC_PORT || 18443), P2P_PORT = RPC_PORT + 1;
const AUTH = 'Basic ' + Buffer.from('gp:gp').toString('base64');
const DATADIR = process.env.BCHN_DATADIR || join(homedir(), `regtest-data-${process.pid}`);

export const addressOf = (lockingBytecode) => lockingBytecodeToCashAddress({ bytecode: lockingBytecode, prefix: 'bchreg' }).address;

export async function rpc(method, params = []) {
  const res = await fetch(`http://127.0.0.1:${RPC_PORT}/`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: AUTH }, body: JSON.stringify({ jsonrpc: '1.0', id: 'gp', method, params }) });
  const j = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
  if (j.error) { const e = new Error(`${method}: ${j.error.message}`); e.rpcCode = j.error.code; e.rpcMessage = j.error.message; throw e; }
  return j.result;
}
// like rpc() but returns { ok, error } so tests can assert on node rejections without try/catch noise
export async function tryRpc(method, params = []) {
  try { return { ok: true, result: await rpc(method, params) }; } catch (e) { return { ok: false, error: e.rpcMessage ?? e.message, code: e.rpcCode }; }
}

let child;
export async function startNode() {
  if (!existsSync(BITCOIND)) throw new Error(`bitcoind not found at ${BITCOIND} (see tools/ in the README)`);
  if ((await tryRpc('getblockchaininfo')).ok) throw new Error(`something already answers on RPC port ${RPC_PORT}; refusing to attach to a foreign node`);
  rmSync(DATADIR, { recursive: true, force: true }); mkdirSync(DATADIR, { recursive: true });
  child = spawn(BITCOIND, ['-regtest', `-datadir=${DATADIR}`, '-rpcuser=gp', '-rpcpassword=gp', `-rpcport=${RPC_PORT}`, `-port=${P2P_PORT}`, '-listen=0', '-discover=0', '-dnsseed=0', '-printtoconsole=0'], { stdio: 'ignore' });
  child.on('error', (e) => { console.error('bitcoind spawn error', e); });
  let died = false; child.on('exit', () => { died = true; });
  for (let i = 0; i < 60 && !died; i++) { await new Promise((r) => setTimeout(r, 500)); const r = await tryRpc('getblockchaininfo'); if (r.ok) { if (r.result.chain !== 'regtest' || r.result.blocks !== 0) throw new Error('node is not a fresh regtest chain'); return r.result; } }
  throw new Error('regtest node did not start');
}
export async function stopNode() {
  if (!child) return;
  await tryRpc('stop');
  await new Promise((res) => { const t = setTimeout(() => { child.kill('SIGKILL'); res(); }, 15000); child.on('exit', () => { clearTimeout(t); res(); }); });
  rmSync(DATADIR, { recursive: true, force: true }); child = undefined;
}
const bye = () => { try { child?.kill('SIGKILL'); } catch {} try { rmSync(DATADIR, { recursive: true, force: true }); } catch {} };
process.on('exit', bye);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { bye(); process.exit(1); });

export const height = async () => rpc('getblockcount');
export async function mine(n, toLockingBytecode) {
  return rpc('generatetoaddress', [n, addressOf(toLockingBytecode)]);
}
// coinbase output of block `hash`: { txid, vout:0, satoshis }
export async function coinbaseOf(hash) {
  const b = await rpc('getblock', [hash, 2]);
  const cb = b.tx[0];
  return { txid: cb.txid, vout: 0, satoshis: BigInt(Math.round(cb.vout[0].value * 1e8)), height: b.height, block: hash };
}
export const send = (hex) => tryRpc('sendrawtransaction', [hex]);
export const mempool = () => rpc('getrawmempool');
