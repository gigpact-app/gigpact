// GigPact XO spike, STEP 1 (no funds needed). One engine per process (the Electrum cache is global), so run twice:
//   node step1.mjs organizer     -> creates the "fund" invitation, writes inv-1.json
//   node step1.mjs worker        -> reads inv-1.json, joins as worker, writes inv-2.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { generateBip39Mnemonic } from '@bitauth/libauth';
import { Engine, XO_SUPPORTED_NETWORKS } from '@xo-cash/engine';
import { p2pkhTemplate } from '@xo-cash/templates';
import { serializeInvitation, deserializeInvitation } from '@xo-cash/utils';
import { pactTemplate } from './pact.template.mjs';

const role = process.argv[2];
if (!['organizer', 'worker'].includes(role)) { console.log('usage: node step1.mjs organizer | worker'); process.exit(1); }
const say = (...a) => console.log(`[step1:${role}]`, ...a);
const fail = (stage, e) => { console.log(`\n[step1:${role}] FAILED at: ${stage}\n${e?.name || ''}: ${e?.message || e}\n${(e?.stack || '').split('\n').slice(0, 6).join('\n')}`); process.exit(1); };
const step = async (name, fn) => { try { const r = await fn(); say('ok:', name); return r; } catch (e) { fail(name, e); } };
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x)).slice(0, 1500);

const F = 'mnemonics.json';
if (!existsSync(F)) writeFileSync(F, JSON.stringify({ organizer: generateBip39Mnemonic(), worker: generateBip39Mnemonic() }, null, 1));
const M = JSON.parse(readFileSync(F, 'utf8'));
mkdirSync(`./data-${role}`, { recursive: true });
const eng = await step('engine starts', () => Engine.create(M[role], { network: XO_SUPPORTED_NETWORKS.chipnet, databasePath: `./data-${role}/`, databaseFilename: 'XO' }));
if (role === 'organizer') await step('import p2pkh', () => eng.importTemplate(p2pkhTemplate));
const tid = (await step('import pact template', () => eng.importTemplate(pactTemplate))).templateIdentifier;
say('pact template id', tid);
const tpl = await eng.getTemplate(tid);

if (role === 'organizer') {
  const inv = await step('create fund invitation', () => eng.createInvitation({ templateIdentifier: tid, actionIdentifier: 'fund', intent: tpl.start.find((s) => s.action === 'fund') }));
  say('stored invitation keys:', Object.keys(inv).join(','));
  say('invitation id:', inv.invitation.invitationIdentifier);
  writeFileSync('inv-1.json', serializeInvitation(inv.invitation));
  say('wrote inv-1.json. Next: node step1.mjs worker');
} else {
  const shared = deserializeInvitation(readFileSync('inv-1.json', 'utf8'));
  say('read inv-1.json, id', shared.invitationIdentifier);
  const free = await step('free roles', () => eng.listAvailableRoles(shared));
  say('free roles:', show(free));
  const acc = await step('accept as worker', () => eng.acceptInvitation(shared, { roleIdentifier: 'worker' }));
  const id = acc.invitation.invitationIdentifier;
  const missing = await step('missing requirements', () => eng.listMissingRequirements(id));
  say('missing:', show(missing));
  writeFileSync('inv-2.json', serializeInvitation(acc.invitation));
  say('wrote inv-2.json');
}
say('DONE. Paste all output above into the chat.');
await eng.stop(); process.exit(0);
