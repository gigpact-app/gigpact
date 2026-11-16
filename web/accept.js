// Worker "accept" (F1) through a connected WizardConnect wallet. No DOM here: everything the screen needs is injected,
// so the same code runs in the tests with a software wallet and a fake network.
//
// Evidence level: R-VM / software wallet (see test/accept.test.mjs). No real wallet has run this yet.
import { SignatureTemplate } from 'cashscript';
import { encodeLockingBytecodeP2pkh, hash160, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { planSpend, changeFloor } from '../src/spend.mjs';
import { declareFunding, newJob } from '../src/k17.mjs';
import { prepareSign, verifySigned, findSponsorPath, WC_PATHS } from '../src/wizard.mjs';
import { UiError, chainFor, addressOf } from './pact.js';
import { PREFIX } from './config.js';

const SCAN = { receive: 60, change: 30 }; // addresses per path name that are looked at for a sponsor coin (a used wallet's open address can be well past 20)
const CONCURRENCY = 8;
const FEE_ALLOWANCE = 3000n;   // rough upper bound for the F1 fee, used only to pre-select sponsor coins (buildTx fits the exact fee)

const lockOfPubkey = (pk) => encodeLockingBytecodeP2pkh(hash160(pk));
const addrOfLock = (lock) => lockingBytecodeToCashAddress({ bytecode: lock, prefix: PREFIX }).address;

// The ONE funding outpoint of this pact (K17). Anything other than exactly one output of exactly F at the funding address
// is refused here, so a stray payment can never be picked up as "the funding".
export function declareFromChain(chain, utxos) {
  const F = chain.params.F;
  const exact = utxos.filter((u) => u.satoshis === F);
  if (utxos.length === 0) throw new UiError('The pact is not funded yet.');
  if (!(utxos.length === 1 && exact.length === 1)) throw new UiError(`The funding address holds ${utxos.length} outputs (${utxos.map((u) => u.satoshis).join(', ')} sat). Exactly one output of ${F} sat is expected, so this pact cannot be accepted automatically.`);
  const u = exact[0];
  if (u.token) throw new UiError('The funding output carries a token, which this pact does not accept.');
  const funded = { txid: u.txid, vout: u.vout, satoshis: u.satoshis, lockingBytecode: Uint8Array.from(chain.locks.funded) };
  return { funded, job: declareFunding(newJob(chain), funded) };
}

// Coins the connected wallet can sign for: plain, token-free outputs at receive/change addresses it controls.
// derive(pathName, index) -> pubkey (in the app: mgr.getPubkey(WC_PATHS[name], BigInt(index))).
export async function walletCoins({ derive, getUtxos, scan = SCAN }) {
  const jobs = [];
  for (const name of Object.keys(WC_PATHS).filter((n) => n !== 'defi')) {
    for (let i = 0; i < (scan[name] ?? 0); i++) {
      const pk = derive(name, i);
      if (pk) jobs.push({ name, i, lock: lockOfPubkey(pk) });
    }
  }
  const out = []; let failed = 0, tokenOutputs = 0, next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      let us = []; try { us = await getUtxos(addrOfLock(j.lock)); } catch { failed += 1; /* one address failing must not hide the others, but it is counted */ }
      for (const u of us) { if (u.token) tokenOutputs += 1; else if (typeof u.satoshis === 'bigint') out.push({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, lockingBytecode: j.lock }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  out.scanned = jobs.length; out.failed = failed; out.tokenOutputs = tokenOutputs;
  return out.sort((a, b) => (a.satoshis === b.satoshis ? 0 : a.satoshis > b.satoshis ? -1 : 1));
}

// Pick one or two sponsor coins: the smallest single coin that covers the fee allowance plus the change floor,
// otherwise the two largest. Throws a plain message if the wallet cannot pay.
export function pickSponsors(coins, changeLock) {
  const need = FEE_ALLOWANCE + changeFloor(changeLock);
  const single = [...coins].reverse().find((c) => c.satoshis >= need);
  if (single) return [single];
  if (coins.length >= 2 && coins[0].satoshis + coins[1].satoshis >= need) return [coins[0], coins[1]];
  const have = coins.reduce((a, c) => a + c.satoshis, 0n);
  throw new UiError(`The connected wallet needs a little more Bitcoin Cash to pay the network fee (about ${need} sat in one or two payments; found ${have} sat in the first ${SCAN.receive} receive and ${SCAN.change} change addresses).`);
}

// pact: decoded pact (with pkV/lockV). keyW: the worker's role key (Uint8Array). mgr: DappConnectionManager-like
// ({ getPubkey(child, BigInt), signTransaction({transaction, inputPaths}) }). provider: { getUtxos, sendRawTransaction }.
// onStep(text) reports progress for the screen. Nothing is sent unless the wallet's answer verifies.
export async function acceptPact({ pact, keyW, mgr, provider, onStep = () => {} }) {
  const chain = chainFor(pact, provider);
  onStep('Checking the funding on the chain…');
  const { funded, job } = declareFromChain(chain, await provider.getUtxos(chain.addresses.funded));
  const derive = (name, i) => mgr.getPubkey(WC_PATHS[name], BigInt(i));
  onStep('Looking for a coin in your wallet to pay the network fee…');
  const coins = await walletCoins({ derive, getUtxos: (a) => provider.getUtxos(a) });
  const pk0 = derive('change', 0);
  if (!pk0) throw new UiError('The wallet has not shared its change address yet. Reconnect and try again.');
  const changeLock = lockOfPubkey(pk0);
  const sponsors = pickSponsors(coins, changeLock);
  const plan = planSpend({ chain, path: 'F1', utxo: funded, sponsors, feeRate: 1, ctx: {}, job });
  const sponsorPaths = plan.sponsors.map((s) => findSponsorPath(s.lockingBytecode, derive));
  const { request, expected } = prepareSign(plan, {
    provider, keys: { W: keyW }, SignatureTemplate, changeLock, sponsorPaths,
    userPrompt: `GigPact: accept the pact "${pact.name}". Only the network fee is paid from your wallet; the pact money stays in the pact.`,
  });
  onStep('Waiting for your wallet to approve…');
  const response = await mgr.signTransaction({ transaction: request.transaction, inputPaths: request.inputPaths });
  const v = verifySigned(expected, response, { derive });
  onStep('Sending to the network…');
  const sent = await provider.sendRawTransaction(v.hex);
  if (typeof sent === 'string' && sent.toLowerCase() !== v.txid) throw new UiError(`The network reported another transaction id (${sent}) than the one we signed (${v.txid}). Check the explorer before trying again.`);
  return { txid: v.txid, fee: v.fee, size: v.size, hex: v.hex, accepted: addressOf(chain.locks.accepted) };
}
