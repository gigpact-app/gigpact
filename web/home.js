// Home page (design A, Cue Sheet). Kept in its own small module so the home page loads without the wallet and contract code.
import { NET, REPO_URL, PRESENTATION_URL, DECLARATION_URL, BEFORE_AFTER_URL, TOKEN_ADDR } from './config.js';
import { h, copy } from './dom.js';

const link = (href, text, cls) => h('a', { href, class: cls }, text);

// Real mainnet run (16 Nov 2026, test amounts), for readers without a wallet. Not simulated.
const PROOF = [
  { step: 'FUND', what: 'Organizer locks the fee', block: '977,601', tx: '6e715ef3ff155358cdcc1283bd5eeb194b9c6a51e4c679477fbeb205ccc86b4a' },
  { step: 'ACCEPT', what: 'Worker accepts, money bound to the worker', block: '977,601', tx: 'e5d41659ee5bba9393cf2b980a3b6dbd32f68910928a8902711b05fb39bb592b' },
  { step: 'PAY', what: 'Organizer pays the worker', block: '977,604', tx: 'f03fc1ef4ddd8b007c3a109f608b96e999d0b95631575e9a66258ece495ba163' },
  { step: 'CANCEL', what: 'Organizer takes the money back before accept', block: '977,609', tx: 'ad5a0abff7f6c8695268cd666aa6f6ed7510b684198f657e2bbdf36469f2df03' },
  { step: 'CLAIM', what: 'Worker claims after the event end', block: '977,619', tx: '62fbc1aba0731717ff6807ebfb5dbf39f71f7851b26e446fa0e853925bb900cf' },
  { step: 'WAIVE', what: 'Worker gives the money back after accept', block: '977,635', tx: '611a52917f957a0ea806e72cbd50c0ffb3f5352573463c404e4b1d2f6ec8fd7c' },
  { step: 'PAY NOW', what: 'Organizer pays at the claim stage', block: '977,647', tx: '9cf26120e411932e019752a6d8e59b22a72dc81341505ff2be0d6923fa2f8690' },
  { step: 'WAIVE', what: 'Worker waives at the claim stage', block: '977,648', tx: '79a6782d58ff7c324bcaac18e16309a2cf9d5db63933637abc25e66703ef380c' },
];
function proofSection() {
  const rows = PROOF.map((e) => {
    const cp = h('button', { class: 'btn small ghost', type: 'button' }, 'Copy id');
    cp.addEventListener('click', () => copy(e.tx, cp));
    const a = h('a', { class: 'btn small ghost', href: `https://3xpl.com/bitcoin-cash/transaction/${e.tx}`, target: '_blank', rel: 'noopener noreferrer' }, 'View on explorer');
    return h('div', { class: 'prow' }, h('span', { class: 'pstep' }, e.step), h('span', { class: 'pwhat' }, e.what), h('code', { class: 'pid' }, `${e.tx.slice(0, 10)}…${e.tx.slice(-8)}`), h('span', { class: 'pblock' }, `block ${e.block}`), h('span', { class: 'pbtn' }, a, cp));
  });
  return h('section', { class: 'sec', id: 'proof' },
    h('div', { class: 'eyebrow' }, 'REAL RUN · BITCOIN CASH MAINNET · 16 NOV 2026'),
    h('h2', { class: 'big' }, 'Not a simulation.'),
    h('p', { class: 'sub wide' }, 'Real transactions with a tiny test amount, signed by a real wallet. One tester played both roles, worker and organizer, with one wallet. Check each one in a block explorer.'),
    h('div', { class: 'ptable' }, ...rows));
}

// Top banner of the home page (hackathon rule): presentation, source code, EMBER2026 donation address, pre-hackathon declaration.
function banner() {
  const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const cp = h('button', { class: 'btn small ghost', type: 'button' }, 'Copy address');
  cp.addEventListener('click', () => copy(TOKEN_ADDR, cp));
  return h('aside', { class: 'banner', 'aria-label': 'Hackathon links' },
    h('div', {}, h('b', {}, 'Presentation'), ext(PRESENTATION_URL, 'BLAZE project slides')),
    h('div', {}, h('b', {}, 'Source code'), ext(REPO_URL, 'github.com/gigpact-app/gigpact')),
    h('div', { class: 'tok' }, h('b', {}, 'EMBER2026 donations (CashTokens address)'), h('code', {}, TOKEN_ADDR), cp),
    h('div', {}, h('b', {}, 'Before the hackathon'), ext(DECLARATION_URL, 'Declaration: no product code before 14 Nov'), ext(BEFORE_AFTER_URL, 'Before / After')));
}

const goTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
function homeTop() {
  const nav = (id, text) => h('button', { class: 'navlink', type: 'button', onclick: () => goTo(id) }, text);
  return h('header', { class: 'top' }, link('#/', [h('i'), 'GigPact'], 'brand'),
    h('nav', { class: 'topnav' }, nav('how', 'How it works'), nav('proof', 'Proof on mainnet'), nav('vision', 'Vision'), h('span', { class: 'chip' }, `Prototype · ${NET}`)));
}

// The example pact on the hero: an illustration of the four cues, not a live pact.
function cueCard() {
  const cues = [
    ['Q1', 'Lock', 'The organizer locks the fee into the pact.', 'DONE', 'ok'],
    ['Q2', 'Accept', 'You accept with your wallet. The money is bound to you.', 'DONE', 'ok'],
    ['Q3', 'Show', 'You play. The fee waits, untouchable.', 'STANDBY', 'warn'],
    ['Q4', 'Paid', 'The organizer pays, or you claim after the event end.', 'WAITING', 'idle'],
  ];
  return h('div', { class: 'cuecard', 'aria-label': 'Example pact' },
    h('div', { class: 'cuehead' }, h('div', {}, h('div', { class: 'k' }, 'EXAMPLE PACT'), h('div', { class: 'cname' }, 'Friday night set, Blue Room')), h('div', { class: 'camt' }, '0.002 BCH')),
    h('div', { class: 'cues' }, ...cues.map(([q, t, note, st, cls], i) =>
      h('div', { class: 'cue' }, h('span', { class: `led ${cls}` }, h('i')),
        h('div', {}, h('div', { class: 'ctitle' }, h('span', { class: 'cq' }, q), t), h('div', { class: 'cnote' }, note)),
        h('span', { class: `cstate ${cls}` }, st)))),
    h('div', { class: 'cfoot' }, 'Money moves only along the pact rules. Until Q2 the organizer can take it back.'));
}

function factsRow() {
  const f = (n, t) => h('div', { class: 'fact' }, h('div', { class: 'fn' }, n), h('div', { class: 'ft' }, t));
  return h('div', { class: 'facts' }, f('4', 'CashScript contracts'), f('16', 'spend paths, fixed rules'), f('7', 'paths run on mainnet with a real wallet so far'), f('MIT', 'open source, public repository'));
}

function quietSection() {
  const col = (k, t, p) => h('div', { class: 'qcol' }, h('i'), h('div', { class: 'k' }, k), h('h3', {}, t), h('p', {}, p));
  return h('section', { class: 'sec', id: 'how' },
    h('div', { class: 'eyebrow' }, 'IF THE ORGANIZER GOES QUIET'),
    h('h2', { class: 'big' }, 'You never need anyone’s permission to be paid.'),
    h('div', { class: 'qrow' },
      col('EVENT ENDS', 'You claim', 'After the event end you press Claim. The pact checks the block height, not anyone’s word.'),
      col('432 BLOCKS · ABOUT 3 DAYS', 'Waiting period', 'A short window in which the organizer can still pay you at once.'),
      col('THEN', 'You collect', 'No signature from the organizer is needed. The fee goes to your payout address.')),
    h('p', { class: 'note' }, 'The claim and the organizer’s answers (pay now, waive) have run on mainnet. Collecting after the 432 blocks is still being tested.'));
}

function vision() {
  const card = (n, t, p) => h('div', { class: 'vcol' }, h('div', { class: 'k' }, n), h('h3', {}, t), h('p', {}, p));
  return h('section', { class: 'sec', id: 'vision' },
    h('div', { class: 'eyebrow' }, 'WHERE IT GOES'),
    h('h2', { class: 'big' }, 'The first market is focused. The vision is every gig.'),
    h('div', { class: 'vrow' },
      card('NOW', 'Musicians and live-event workers', 'Performers, sound and light technicians, stage crew: booked for a date, paid after the show.'),
      card('NEXT', 'Every event worker, worldwide', 'DJs, dancers, actors, hosts, photographers and more.'),
      card('THEN', 'Any trade paid for a dated job', 'The same lock-before-work pact fits every sector. Only the label on the job changes.')));
}

// ---- screens ---------------------------------------------------------------------------------------------------
export function renderHome(app) {
  const seeRun = h('button', { class: 'textlink', type: 'button', onclick: () => goTo('proof') }, 'See the real mainnet run');
  app.replaceChildren(h('div', { class: 'wrap wide' }, banner(), homeTop(),
    h('section', { class: 'hero' },
      h('div', { class: 'herotext' },
        h('div', { class: 'eyebrow' }, 'CUE SHEET FOR EVERY GIG'),
        h('h1', {}, 'Get paid for the gig. ', h('em', {}, 'Before you play.')),
        h('p', { class: 'lead' }, 'The organizer locks your fee on Bitcoin Cash before the show. When it is done, the pact pays you. No chasing invoices, no ghosting.'),
        h('div', { class: 'ctas' }, link('#/new', 'Create a pact for my gig', 'btn'), seeRun),
        h('p', { class: 'tagline' }, 'Built for musicians first. Made for every gig.')),
      cueCard()),
    factsRow(), quietSection(), proofSection(), vision(),
    h('footer', { class: 'foot' },
      h('div', {}, h('b', {}, 'GigPact'), h('p', {}, 'Prototype on Bitcoin Cash mainnet, built solo for BCH BLAZE 2026. You can create a pact, fund it, accept it with a WizardConnect wallet, claim after the event, and pay out, waive or take the money back. Collecting after the 3-day waiting period and the dispute steps are still being tested. Use small amounts. No independent audit. So far it is built and tested for gigs only; the wider sectors are our vision.')),
      h('div', { class: 'flinks' }, ...[[REPO_URL, 'Source on GitHub'], [DECLARATION_URL, 'Declaration'], [BEFORE_AFTER_URL, 'Before / After']].map(([u, t]) => h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, t))))));
}

