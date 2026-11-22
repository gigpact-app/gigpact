process.on('unhandledRejection',(e)=>console.log('[warn] ignored background error:',e?.message||e));
// GigPact XO spike, STEP 3: spend the funded pact through an XO action.
//   NET=mainnet ACTION=pay    node step3.mjs organizer   (organizer pays the worker)
//   NET=mainnet ACTION=waive  node step3.mjs worker      (worker gives the fee back)
//   NET=mainnet ACTION=claim  node step3.mjs worker      (worker claims after the event end block)
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { hexToBin, binToHex } from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import { serializeInvitation } from '@xo-cash/utils';
import { chipnetServersWithBlockchain, mainnetServersWithBlockchain } from '@electrum-cash/servers';
import { pactTemplate } from './pact.template.mjs';

const role = process.argv[2];
const ACTION = process.env.ACTION;
const OUT = { pay: 'toWorkerOutput', waive: 'toOrganizerOutput', claim: 'toWorkerOutput' }[ACTION];
const LOCK_VAR = { pay: 'payoutLockingScript', waive: 'refundLockingScript', claim: 'payoutLockingScript' }[ACTION];
const NEED_ROLE = { pay: 'organizer', waive: 'worker', claim: 'worker' }[ACTION];
if (!OUT || role !== NEED_ROLE) { console.log('usage: ACTION=pay node step3.mjs organizer | ACTION=waive|claim node step3.mjs worker'); process.exit(1); }
const say = (...a) => console.log(`[step3:${role}:${ACTION}]`, ...a);
const show = (v, n = 2000) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? binToHex(x) : x)).slice(0, n);
const fail = (stage, e) => { console.log(`\n[step3:${role}:${ACTION}] FAILED at: ${stage}\n${e?.name || ''}: ${e?.message || e}\n${(e?.stack || '').split('\n').slice(0, 7).join('\n')}`); process.exit(1); };
const step = async (name, fn) => { try { const r = await fn(); say('ok:', name); return r; } catch (e) { fail(name, e); } };

const NET = process.env.NET || 'chipnet';
const WANT = process.env.SERVER || (NET === 'mainnet' ? 'bch.imaginary' : 'ninja');
const SERVERS = (NET === 'mainnet' ? mainnetServersWithBlockchain : chipnetServersWithBlockchain).filter((x) => x.host.includes(WANT));
const M = JSON.parse(readFileSync('mnemonics.json', 'utf8'));
const DIR = `./data-${NET}-${role}`;
const eng = await step('engine starts', () => Engine.create(M[role], { network: XO_SUPPORTED_NETWORKS[NET], electrumServers: SERVERS, databasePath: `${DIR}/`, databaseFilename: 'XO' }));
const p2pkhId = (await step('import p2pkh', () => eng.importTemplate(p2pkhTemplate))).templateIdentifier;
const tid = (await step('import pact template', () => eng.importTemplate(pactTemplate))).templateIdentifier;
await step('default policies', () => eng.setDefaultPolicies({ receive: { templateIdentifier: p2pkhId }, change: { templateIdentifier: p2pkhId } }));

// find the pact output this account tracks
let pact;
for (let i = 0; i < 18 && !pact; i++) {
  const all = await eng.listUnspentOutputs();
  pact = all.find((u) => u.templateIdentifier === tid);
  if (!pact) { say('pact output not tracked yet; tracked:', show(all.map((u) => [u.templateIdentifier.slice(0, 8), u.valueSatoshis, u.status])), '... retry in 10 s'); await sleep(10000); }
}
if (!pact) fail('find pact output', new Error('this account tracks no pact output (see the tracked list above)'));
say('pact output', show(pact));
const sh = (await eng.listScriptHashData({ scriptHash: pact.scriptHash }))[0];
say('stored script hash data', show(sh, 3000));
const vars = sh?.variables ?? {};
const lockValue = vars[LOCK_VAR];
if (!lockValue) fail('read stored variable', new Error(`script hash data has no ${LOCK_VAR}`));
const eventEnd = vars.eventEndBlock;
if (ACTION === 'claim') {
  const cs = await eng.getChainStatus();
  say('chain height', cs.currentHeight, '| event end block', eventEnd);
  if (Number(cs.currentHeight) < Number(eventEnd)) fail('claim too early', new Error(`the claim path opens at block ${eventEnd}; current ${cs.currentHeight}`));
}
const fee = 500;
const inv = await step('create invitation', () => eng.createInvitation({ templateIdentifier: tid, actionIdentifier: ACTION, roleIdentifier: role }));
const id = inv.invitation.invitationIdentifier;
say('invitation id', id);
const variables = [{ variableIdentifier: LOCK_VAR, value: lockValue }];
if (ACTION === 'claim') variables.push({ variableIdentifier: 'eventEndBlock', value: Number(eventEnd) });
await step('append input + output', () => eng.appendInvitation(id, {
  templateIdentifier: tid, actionIdentifier: ACTION, roleIdentifier: role, variables,
  inputs: [{ inputIdentifier: `${ACTION}Input`, outpointTransactionHash: typeof pact.outpointTransactionHash === 'string' ? hexToBin(pact.outpointTransactionHash) : pact.outpointTransactionHash, outpointIndex: pact.outpointIndex }],
  outputs: [{ outputIdentifier: OUT, valueSatoshis: BigInt(pact.valueSatoshis - fee) }],
}));
say('missing requirements:', show(await eng.listMissingRequirements(id)));
await step('sign pact input 0', () => eng.signInvitation(id, 0));
say('missing requirements after signing:', show(await eng.listMissingRequirements(id)));
const res = await step('execute action + broadcast', () => eng.executeAction(id, { broadcastTransaction: true }));
say('SPEND TXID:', res.builtTransaction.transactionHash, ' bytes', res.builtTransaction.transactionByteLength);
writeFileSync(`s3-${ACTION}-inv.json`, serializeInvitation(res.storedInvitation.invitation));
writeFileSync(`s3-${ACTION}-result.json`, JSON.stringify({ txid: res.builtTransaction.transactionHash, hex: res.builtTransaction.serializedTransaction }, null, 1));
say('wrote', `s3-${ACTION}-inv.json and s3-${ACTION}-result.json`);
say('DONE. Paste ALL output into the chat.');
await eng.stop(); process.exit(0);
