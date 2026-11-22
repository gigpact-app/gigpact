process.on('unhandledRejection',(e)=>console.log('[warn] ignored background error:',e?.message||e));
// GigPact XO spike, STEP 2: fund a pact on chipnet. Needs TWO terminal tabs, both in this folder:
//   tab 1:  node step2.mjs organizer      (prints a chipnet address; waits for you to fund it)
//   tab 2:  node step2.mjs worker
// Before the first run: rm -f s2-*.json   (the two sides talk through those files)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { hexToBin, binToHex, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import { serializeInvitation, deserializeInvitation } from '@xo-cash/utils';
import { chipnetServersWithBlockchain, mainnetServersWithBlockchain } from '@electrum-cash/servers';
import { pactTemplate } from './pact.template.mjs';

const role = process.argv[2];
if (!['organizer', 'worker'].includes(role)) { console.log('usage: node step2.mjs organizer | worker'); process.exit(1); }
const say = (...a) => console.log(`[step2:${role}]`, ...a);
const show = (v, n = 1800) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? binToHex(x) : x)).slice(0, n);
const fail = (stage, e) => { console.log(`\n[step2:${role}] FAILED at: ${stage}\n${e?.name || ''}: ${e?.message || e}\n${(e?.stack || '').split('\n').slice(0, 7).join('\n')}`); process.exit(1); };
const step = async (name, fn) => { try { const r = await fn(); say('ok:', name); return r; } catch (e) { fail(name, e); } };
const waitFile = async (f, label, ms = 1_200_000) => { const t0 = Date.now(); let n = 0; while (!existsSync(f)) { if (Date.now() - t0 > ms) fail(`waiting for ${f}`, new Error('timeout')); if (n++ % 6 === 0) say(`waiting for ${f} (${label}) ...`); await sleep(5000); } await sleep(500); return readFileSync(f, 'utf8'); };

// NET=mainnet or NET=chipnet (default chipnet). ONE Electrum server only: the default lists mix servers that can disagree (header sync fails).
const NET = process.env.NET || 'chipnet';
if (!['mainnet', 'chipnet'].includes(NET)) { console.log('NET must be mainnet or chipnet'); process.exit(1); }
const WANT = process.env.SERVER || (NET === 'mainnet' ? 'bch.imaginary' : 'ninja');
const SERVERS = (NET === 'mainnet' ? mainnetServersWithBlockchain : chipnetServersWithBlockchain).filter((x) => x.host.includes(WANT));
if (!SERVERS.length) { console.log('unknown SERVER filter:', WANT); process.exit(1); }
const PREFIX = NET === 'mainnet' ? 'bitcoincash' : 'bchtest';
say('network:', NET, '| electrum server:', SERVERS.map((x) => x.host).join(','));
const M = JSON.parse(readFileSync('mnemonics.json', 'utf8'));
const DIR = `./data-${NET}-${role}`;
mkdirSync(DIR, { recursive: true });
const eng = await step('engine starts', () => Engine.create(M[role], { network: XO_SUPPORTED_NETWORKS[NET], electrumServers: SERVERS, databasePath: `${DIR}/`, databaseFilename: 'XO' }));
const p2pkhId = (await step('import p2pkh', () => eng.importTemplate(p2pkhTemplate))).templateIdentifier;
const tid = (await step('import pact template', () => eng.importTemplate(pactTemplate))).templateIdentifier;
say('pact template id', tid);
await step('default policies (p2pkh receive+change)', () => eng.setDefaultPolicies({ receive: { templateIdentifier: p2pkhId }, change: { templateIdentifier: p2pkhId } }));
const ownLock = await step('own p2pkh locking bytecode', () => eng.generateLockingBytecodeFromDefaultPolicy('receive'));
const addr = lockingBytecodeToCashAddress({ bytecode: hexToBin(ownLock), prefix: PREFIX });
say(role, 'wallet address:', addr.address ?? addr);
const secretPub = async (ident) => {
  const all = await eng.listSecretData();
  const mine = all.filter((s) => s.secretIdentifier === ident);
  if (!mine.length) throw new Error(`no stored secret named ${ident}; stored: ${show(all.map((s) => ({ ...s, value: undefined })))}`);
  return eng.getSecretPublicKey(mine[mine.length - 1].secretLookupKey);
};
const fundAction = (await eng.getTemplate(tid)).start.find((s) => s.action === 'fund');
const base = { templateIdentifier: tid, actionIdentifier: 'fund' };

const RESUME = process.env.RESUME === '1';
if (role === 'organizer') {
  let id;
  if (RESUME) {
    id = deserializeInvitation(readFileSync('s2-inv-1.json', 'utf8')).invitationIdentifier;
    const stored = await eng.getInvitation(id);
    if (!stored) fail('resume', new Error(`invitation ${id} is not in the local store`));
    say('RESUME: using stored invitation', id);
  } else {
  const inv = await step('create fund invitation', () => eng.createInvitation({ ...base, intent: fundAction }));
  id = inv.invitation.invitationIdentifier;
  say('invitation id', id);
  writeFileSync('s2-inv-1.json', serializeInvitation(inv.invitation));
  say('wrote s2-inv-1.json. Now start the worker in the other tab: node step2.mjs worker');

  const w = deserializeInvitation(await waitFile('s2-inv-2.json', 'worker'));
  await step('merge worker commit', () => eng.updateInvitation(w));

  // wallet funds
  const t0 = Date.now(); let utxos = [];
  say(`FUND THIS ${NET.toUpperCase()} ADDRESS (at least 10000 sats):`, addr.address ?? addr);
  while (Date.now() - t0 < 1_500_000) {
    utxos = await eng.listSpendableUnspentOutputs({ templateIdentifier: p2pkhId });
    if (utxos.length) break;
    say('no spendable funds yet, all tracked outputs:', (await eng.listUnspentOutputs()).length, '... checking again in 10 s');
    await sleep(10000);
  }
  if (!utxos.length) fail('wait for funds', new Error('no funds arrived within 25 minutes'));
  const u = utxos.sort((a, b) => b.valueSatoshis - a.valueSatoshis)[0];
  say('using utxo', show(u));

  const cs = await step('chain status', () => eng.getChainStatus());
  say('chain status', show(cs));
  const tip = Number(cs.currentHeight ?? cs.height ?? cs.chainHeight ?? cs.blockHeight);
  if (!Number.isFinite(tip)) fail('chain height', new Error('cannot read the height from the chain status above'));
  const eventEnd = tip + 3;
  const wLock = w.commits.flatMap((c) => c.data?.variables ?? []).find((v) => v.variableIdentifier === 'payoutLockingScript')?.value;
  if (!wLock) fail('read worker payout lock', new Error('worker commit has no payoutLockingScript'));
  const orgPub = await step('organizer public key', () => secretPub('organizerKey'));
  say('organizer pubkey', orgPub, '| worker payout lock', wLock, '| event end block', eventEnd);

  await step('append variables + fund output + wallet input', () => eng.appendInvitation(id, {
    ...base, roleIdentifier: 'organizer',
    variables: [
      { variableIdentifier: 'organizerPublicKey', value: orgPub, roleIdentifier: 'organizer' },
      { variableIdentifier: 'refundLockingScript', value: ownLock },
      { variableIdentifier: 'fundedSatoshis', value: 5000 },
      { variableIdentifier: 'eventEndBlock', value: eventEnd },
    ],
    outputs: [{ outputIdentifier: 'fundOutput' }],
    inputs: [{ outpointTransactionHash: typeof u.outpointTransactionHash === 'string' ? hexToBin(u.outpointTransactionHash) : u.outpointTransactionHash, outpointIndex: u.outpointIndex }],
  }));
  }
  const ch = await step('change availability', () => eng.calculateChangeAvailability(id));
  say('change availability', show(ch));
  if (ch.canAddChange) await step('add change', () => eng.addChangeToInvitation(id, ownLock));
  say('missing requirements:', show(await eng.listMissingRequirements(id)));
  await step('sign wallet input 0', () => eng.signInvitation(id, 0));
  say('missing requirements after signing:', show(await eng.listMissingRequirements(id)));
  const res = await step('execute fund action + broadcast', () => eng.executeAction(id, { broadcastTransaction: true }));
  say('FUND TXID:', res.builtTransaction.transactionHash, ' fee', res.builtTransaction.estimatedFeeSatoshis, ' bytes', res.builtTransaction.transactionByteLength);
  writeFileSync('s2-inv-3.json', serializeInvitation(res.storedInvitation.invitation));
  writeFileSync('s2-result.json', JSON.stringify({ txid: res.builtTransaction.transactionHash, hex: res.builtTransaction.serializedTransaction }, null, 1));
  say('wrote s2-inv-3.json and s2-result.json');
  say('tracked outputs now:', show(await eng.listUnspentOutputs()));
} else {
  const shared = deserializeInvitation(await waitFile('s2-inv-1.json', 'organizer'));
  say('read s2-inv-1.json, id', shared.invitationIdentifier);
  const acc = await step('accept as worker', () => eng.acceptInvitation(shared, { roleIdentifier: 'worker' }));
  const id = acc.invitation.invitationIdentifier;
  const wPub = await step('worker public key', () => secretPub('workerKey'));
  say('worker pubkey', wPub, '| payout lock', ownLock);
  const up = await step('append worker variables', () => eng.appendInvitation(id, {
    ...base, roleIdentifier: 'worker',
    variables: [
      { variableIdentifier: 'workerPublicKey', value: wPub, roleIdentifier: 'worker' },
      { variableIdentifier: 'payoutLockingScript', value: ownLock },
    ],
  }));
  say('missing requirements:', show(await eng.listMissingRequirements(id)));
  writeFileSync('s2-inv-2.json', serializeInvitation(up.invitation));
  say('wrote s2-inv-2.json. Waiting for the organizer to fund and broadcast ...');
  const fin = deserializeInvitation(await waitFile('s2-inv-3.json', 'funded invitation', 2_400_000));
  await step('merge the funded invitation', () => eng.updateInvitation(fin));
  await sleep(4000);
  say('tracked outputs now:', show(await eng.listUnspentOutputs()));
}
say('DONE. Paste ALL output of this tab into the chat. (Press Ctrl+C if it does not exit by itself.)');
await eng.stop(); process.exit(0);
