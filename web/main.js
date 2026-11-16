// GigPact web app (skeleton). Plain DOM, no framework. All text from links goes in via textContent, never innerHTML.
import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import { NET, MIN_FEE_SAT, MIN_LEAD_BLOCKS } from './config.js';
import { UiError, newKey, pubOf, lockOfPk, parseAddress, addressOf, parseBch, fmtBch, encodePact, decodePact, pactId, chainFor, checkNumbers, cleanName } from './pact.js';
import { provider, tip, utxosAt } from './net.js';
import { h, copy } from './dom.js';
import { workerPanel } from './worker-ui.js';

const app = document.getElementById('app');
let timers = [];
const stopTimers = () => { timers.forEach(clearInterval); timers = []; };

const link = (href, text, cls) => h('a', { href, class: cls }, text);

// ---- keys kept in this browser ----------------------------------------------------------------------------
const store = {
  get() { try { return JSON.parse(localStorage.getItem('gigpact.keys') || '{}'); } catch { return {}; } },
  put(pkHex, skHex, extra = {}) { try { const o = store.get(); o[pkHex] = { sk: skHex, ...extra }; localStorage.setItem('gigpact.keys', JSON.stringify(o)); return true; } catch { return false; } },
  find(pkHex) { return store.get()[pkHex]; },
};

// ---- shared pieces ------------------------------------------------------------------------------------------
function top() {
  return h('header', { class: 'top' }, link('#/', [h('i'), 'GigPact'], 'brand'), h('span', { class: 'chip' }, `Prototype · ${NET}`));
}
function stripeFor(seed) {
  const d = sha256.hash(new TextEncoder().encode(seed));
  const bars = [];
  for (let i = 0; i < 28; i++) bars.push(h('span', { style: `width:${2 + (d[i] % 5) * 2}px;margin-right:${1 + (d[i + 1] % 3)}px` }));
  return h('div', { class: 'stripe', 'aria-hidden': 'true' }, bars);
}
function pass(p, { state, stateClass, eta, seed }) {
  return h('div', { class: 'pass' },
    h('div', { class: 'k' }, 'Gig pact'),
    h('div', { class: 'name' }, p.name || 'Untitled gig'),
    h('div', { class: 'amt' }, `${fmtBch(p.F)} BCH`, h('small', {}, `${p.F} sat`)),
    h('div', { class: 'meta' },
      h('div', {}, 'Worker is paid after ', h('span', { class: 'eta' }, eta ?? `block ${p.tEnd}`)),
      h('div', {}, 'Payout to ', h('code', {}, addressOf(p.lockW).replace(/^[a-z]+:/, '').slice(0, 10) + '…'))),
    h('div', { class: 'tear' }),
    stripeFor(seed ?? p.name + p.F), 
    h('div', { style: 'margin-top:12px' }, h('span', { class: `state ${stateClass ?? ''}` }, state)));
}
async function etaText(tEnd) {
  try { const t = await tip(); const ms = Date.now() + (tEnd - t) * 600_000; return `${new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} (block ${tEnd})`; } catch { return `block ${tEnd}`; }
}

// ---- screens ---------------------------------------------------------------------------------------------------
function home() {
  app.replaceChildren(h('div', { class: 'wrap' }, top(),
    h('h1', {}, 'Get paid for the gig. ', h('em', {}, 'Before you play.')),
    h('p', { class: 'lead' }, 'The organizer locks your fee on Bitcoin Cash before the show. When it is done, the pact pays you. No chasing invoices, no ghosting.'),
    link('#/new', 'Create a pact for my gig', 'btn'),
    h('div', { class: 'steps' },
      h('div', { class: 'step' }, h('b', {}, '1 · LOCK'), h('h3', {}, 'Agree the fee'), h('p', {}, 'You set the fee and the event end. The organizer locks the money into your pact before the gig.')),
      h('div', { class: 'step' }, h('b', {}, '2 · PLAY'), h('h3', {}, 'Do the show'), h('p', {}, 'You accept the pact and play. The money cannot be spent by anyone except along the pact’s rules.')),
      h('div', { class: 'step' }, h('b', {}, '3 · GET PAID'), h('h3', {}, 'The pact pays you'), h('p', {}, 'After the show you claim your fee. If the organizer stays silent, it pays out to you on its own.'))),
    h('p', { class: 'note' }, 'Prototype. This build creates pacts and funding addresses and watches the chain. Accepting, releasing and refunding are being added and are not live yet.')));
}

function newPact() {
  const err = h('p', { class: 'err', role: 'alert' });
  const f = { name: h('input', { id: 'name', maxlength: 60, placeholder: 'Friday night set, Blue Room', autocomplete: 'off' }),
    fee: h('input', { id: 'fee', inputmode: 'decimal', placeholder: '0.002', autocomplete: 'off' }),
    end: h('input', { id: 'end', type: 'datetime-local' }),
    addr: h('input', { id: 'addr', placeholder: `${NET === 'mainnet' ? 'bitcoincash:q…' : 'bchtest:q…'}`, autocomplete: 'off', spellcheck: 'false' }) };
  const out = h('div');
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Create pact request');
  const form = h('form', { class: 'card', novalidate: true },
    h('label', { for: 'name' }, 'Gig'), f.name,
    h('label', { for: 'fee' }, 'Your fee (BCH)'), f.fee, h('div', { class: 'hint' }, `At least ${fmtBch(MIN_FEE_SAT)} BCH.`),
    h('label', { for: 'end' }, 'When does the event end?'), f.end, h('div', { class: 'hint' }, 'You can claim your fee after this moment. It is converted to a block height, about 10 minutes per block.'),
    h('label', { for: 'addr' }, 'Where should the money go? (your BCH address)'), f.addr,
    err, h('div', { class: 'row' }, btn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const name = cleanName(f.name.value); if (!name) throw new UiError('Give the gig a name.');
      const F = parseBch(f.fee.value); if (F < MIN_FEE_SAT) throw new UiError(`The fee must be at least ${fmtBch(MIN_FEE_SAT)} BCH.`);
      if (!f.end.value) throw new UiError('Pick when the event ends.');
      const endMs = new Date(f.end.value).getTime(); if (!Number.isFinite(endMs)) throw new UiError('Pick when the event ends.');
      const lockW = parseAddress(f.addr.value);
      let t; try { t = await tip(); } catch { throw new UiError('Could not reach the Bitcoin Cash network to read the current block. Check your connection and try again.'); }
      const tEnd = t + Math.ceil((endMs - Date.now()) / 600_000);
      if (tEnd < t + MIN_LEAD_BLOCKS) throw new UiError('The event end must be at least about an hour from now.');
      const sk = newKey(), pkW = pubOf(sk);
      const p = { name, F, tEnd, pkW, lockW };
      try { checkNumbers(p); } catch (x) { throw new UiError(`This fee cannot be used: ${x.message}`); }
      if (!store.put(binToHex(pkW), binToHex(sk), { role: 'W' })) throw new UiError('This browser would not let the app save your signing key, so the pact cannot be created. Allow site storage and try again.');
      const code = encodePact(p), url = `${location.origin}${location.pathname}#/pact/${code}`;
      out.replaceChildren(h('div', { class: 'panel', style: 'margin-top:22px' },
        h('h2', {}, 'Send this link to the organizer'),
        h('p', { class: 'sub' }, 'They open it, enter their refund address, and get the address to fund. Nothing is locked until they pay.'),
        h('div', { class: 'addr' }, url),
        h('div', { class: 'row' }, (() => { const b = h('button', { class: 'btn small', type: 'button' }, 'Copy link'); b.addEventListener('click', () => copy(url, b)); return b; })(), link(`#/pact/${code}`, 'Open it here', 'btn small ghost')),
        h('p', { class: 'note' }, 'Your signing key for this pact is stored in this browser only. Do not clear this site’s data until the pact is settled. Key backup is not built yet.')));
      btn.textContent = 'Create another';
    } catch (x) { err.textContent = x instanceof UiError ? x.message : `Something went wrong: ${x.message}`; btn.textContent = 'Create pact request'; }
    btn.disabled = false;
  });
  app.replaceChildren(h('div', { class: 'wrap' }, top(), h('h2', {}, 'Create a pact for your gig'), h('p', { class: 'sub' }, 'Four quick questions. You get a link to send to the organizer.'), form, out));
}

async function pactScreen(code) {
  const wrap = h('div', { class: 'wrap' }, top());
  app.replaceChildren(wrap);
  let p; try { p = decodePact(code); } catch (x) { wrap.append(h('p', { class: 'err' }, x.message), link('#/', 'Back to start')); return; }
  try { checkNumbers(p); } catch (x) { wrap.append(h('p', { class: 'err' }, `This pact has terms that cannot work: ${x.message}`)); return; }
  const pkW = binToHex(p.pkW), mineW = store.find(pkW), pkVhex = p.pkV && binToHex(p.pkV), mineV = pkVhex && store.find(pkVhex);
  const fillEta = () => etaText(p.tEnd).then((t) => document.querySelectorAll('.eta').forEach((e) => { e.textContent = t; }));

  if (!p.pkV) { // organizer, step 1: refund address -> V key -> funding address
    if (mineW) { // the worker opened their own request link: it is meant for the organizer
      const own = `${location.origin}${location.pathname}#/pact/${code}`;
      wrap.append(h('div', { class: 'grid2' }, h('div', { class: 'panel' }, h('h2', {}, 'This is your request link'),
        h('p', { class: 'sub' }, 'Send it to the organizer. They open it, enter a refund address and get the address to fund. Nothing is locked until they pay.'),
        h('div', { class: 'addr' }, own), h('div', { class: 'row' }, (() => { const b = h('button', { class: 'btn small', type: 'button' }, 'Copy link'); b.addEventListener('click', () => copy(own, b)); return b; })())),
        pass(p, { state: 'Waiting for the organizer', stateClass: 'warn', seed: code })));
      fillEta();
      return;
    }
    const id = pactId(code), saved = store.find(`req:${id}`);
    const err = h('p', { class: 'err', role: 'alert' });
    const addr = h('input', { id: 'refund', placeholder: `${NET === 'mainnet' ? 'bitcoincash:q…' : 'bchtest:q…'}`, autocomplete: 'off', spellcheck: 'false' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Get the funding address');
    const form = h('form', { class: 'card', novalidate: true },
      h('h2', {}, 'You are the organizer'), h('p', { class: 'sub' }, 'Pay the fee into this pact before the gig. If the worker never accepts, you can take it back.'),
      h('label', { for: 'refund' }, 'Your refund address (BCH)'), addr, h('div', { class: 'hint' }, 'If the pact is cancelled or settled in your favour, the money returns here.'), err, h('div', { class: 'row' }, btn));
    form.addEventListener('submit', (e) => {
      e.preventDefault(); err.textContent = '';
      try {
        const lockV = parseAddress(addr.value);
        const sk = newKey(), pkV = pubOf(sk);
        if (!store.put(binToHex(pkV), binToHex(sk), { role: 'V' })) throw new UiError('This browser would not let the app save your signing key. Allow site storage and try again.');
        const full = { ...p, pkV, lockV };
        chainFor(full, provider); // throws if the terms are not allowed
        location.hash = `#/pact/${encodePact(full)}`;
      } catch (x) { err.textContent = x instanceof UiError ? x.message : `This cannot be created: ${x.message}`; }
    });
    wrap.append(h('div', { class: 'grid2' }, h('div', {}, form), pass(p, { state: 'Waiting for the organizer', stateClass: 'warn', seed: code })));
    fillEta();
    return;
  }

  // full pact (V and W known): funding address + live status
  let chain; try { chain = chainFor(p, provider); } catch (x) { wrap.append(h('p', { class: 'err' }, `This pact has terms that cannot work: ${x.message}`)); return; }
  const fundAddr = chain.addresses.funded;
  const role = mineV ? 'organizer' : mineW ? 'worker' : 'viewer';
  const statusEl = h('span', { class: 'state warn' }, 'Checking the chain…'), detail = h('p', { class: 'sub' });
  const setState = (txt, cls, d) => { statusEl.textContent = txt; statusEl.className = `state ${cls}`; detail.textContent = d ?? ''; const c = document.querySelector('.pass .state'); if (c) { c.textContent = txt; c.className = `state ${cls}`; } };
  let wp = null;
  async function refresh() {
    try {
      const A = chain.addresses;
      const [us, acc, later] = await Promise.all([utxosAt(A.funded), utxosAt(A.accepted), Promise.all([A.requested, A.d100, A.d50].map((a) => utxosAt(a)))]);
      const accOk = acc.filter((u) => u.satoshis === p.F);
      if (accOk.length === 1 && acc.length === 1 && us.length === 0) { setState('Accepted', 'ok', `The worker accepted. Pact money is locked at ${accOk[0].txid}:${accOk[0].vout}`); wp?.setFunded(false, true); return; }
      if (acc.length || later.some((x) => x.length)) { setState('Past the funded stage', 'warn', 'This pact has moved on. Later stages are not shown in this build yet.'); wp?.setFunded(false); return; }
      const exact = us.filter((u) => u.satoshis === p.F);
      if (exact.length === 1 && us.length === 1) { setState('Funded', 'ok', `Funding found on chain: ${exact[0].txid}:${exact[0].vout}`); wp?.setFunded(true); }
      else if (us.length === 0) { setState('Waiting for funding', 'warn', 'Nothing has arrived at the funding address yet.'); wp?.setFunded(false); }
      else { setState('Funding needs a look', 'bad', `Found ${us.length} output(s) at the address (${us.map((u) => u.satoshis).join(', ')} sat). Exactly one output of ${p.F} sat is expected.`); wp?.setFunded(false); }
    } catch { setState('Cannot check the chain', 'bad', 'The network did not answer. Retrying.'); }
  }
  const sendBack = `${location.origin}${location.pathname}#/pact/${code}`;
  const roleBox = role === 'organizer'
    ? h('div', { class: 'panel' }, h('h2', {}, 'Fund this pact'), h('p', { class: 'sub' }, `Send exactly ${fmtBch(p.F)} BCH to this address, in one payment, from any wallet:`),
        h('div', { class: 'addr' }, fundAddr), h('div', { class: 'row' }, (() => { const b = h('button', { class: 'btn small', type: 'button' }, 'Copy address'); b.addEventListener('click', () => copy(fundAddr, b)); return b; })()),
        h('p', { class: 'note' }, 'Send it as ONE payment of the exact amount. Anything else at this address is not counted as the fee. After funding, send the worker this same page link so they can accept:'),
        h('div', { class: 'addr' }, sendBack), h('div', { class: 'row' }, (() => { const b = h('button', { class: 'btn small ghost', type: 'button' }, 'Copy link for the worker'); b.addEventListener('click', () => copy(sendBack, b)); return b; })()))
    : role === 'worker'
      ? (wp = workerPanel({ pact: p, keyW: hexToBin(mineW.sk), onDone: () => refresh() })).el
      : h('div', { class: 'panel' }, h('h2', {}, 'Pact overview'), h('p', { class: 'sub' }, 'This browser holds no key for this pact, so it is read-only here.'));
  wrap.append(h('div', { class: 'grid2' }, h('div', {}, roleBox, h('p', { style: 'margin-top:14px' }, statusEl), detail,
    h('p', { class: 'note' }, 'Funding address of this pact: ', h('code', {}, fundAddr.replace(/^[a-z]+:/, '').slice(0, 14) + '…'))), pass(p, { state: 'Pact', stateClass: '', seed: fundAddr })));
  fillEta(); refresh(); timers.push(setInterval(refresh, 20000));
}

// ---- router ----------------------------------------------------------------------------------------------------
function route() {
  stopTimers();
  const hash = location.hash.replace(/^#/, '') || '/';
  const m = hash.match(/^\/pact\/([A-Za-z0-9_-]+)$/);
  if (hash === '/') home(); else if (hash === '/new') newPact(); else if (m) pactScreen(m[1]); else home();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
