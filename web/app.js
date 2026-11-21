// GigPact web app: the pact screens (create, fund, accept, settle). Loaded on demand from main.js. Plain DOM, no framework. All text from links goes in via textContent, never innerHTML.
import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import { NET, MIN_FEE_SAT, MIN_LEAD_BLOCKS } from './config.js';
import { UiError, newKey, pubOf, lockOfPk, parseAddress, addressOf, parseBch, fmtBch, encodePact, decodePact, pactId, termsOf, chainFor, checkNumbers, cleanName } from './pact.js';
import { provider, tip, utxosAt } from './net.js';
import { h, copy } from './dom.js';
import { workerPanel } from './worker-ui.js';
import { cancelPanel } from './cancel-ui.js';
import { settlePanel } from './settle-ui.js';
import { qrSvg } from './dom.js';
import { qrFor, resetWalletListeners } from './wallet.js';
import { confirmedFrom } from './confirm.js';

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
      h('div', {}, 'Payout to ', h('code', { class: 'full' }, addressOf(p.lockW).replace(/^[a-z]+:/, '')))),
    h('div', { class: 'tear' }),
    stripeFor(seed ?? p.name + p.F), 
    h('div', { style: 'margin-top:12px' }, h('span', { class: `state ${stateClass ?? ''}` }, state)));
}
async function etaText(tEnd) {
  try { const t = await tip(); if (tEnd <= t) return `block ${tEnd} (already reached)`; const q = 900_000, ms = Math.round((Date.now() + (tEnd - t) * 600_000) / q) * q; return `about ${new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} (block ${tEnd}; the exact time depends on the blocks)`; } catch { return `block ${tEnd}`; }
}

// Approximate USD value of a BCH amount, shown next to the fee. Purely informational: the pact always uses the BCH amount typed.
let usdRate = null;
const rateReady = fetch('https://api.coinbase.com/v2/prices/BCH-USD/spot').then((r) => r.json()).then((j) => { const v = Number(j?.data?.amount); if (v > 0) usdRate = v; }).catch(() => {});
const localInput = (d) => { const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };

// Key backup panel. The key lives only in this browser's storage, so a closed private window, a cleared site or another browser
// (for example the in-app browser of a chat app) loses it for good. who = 'organizer' | 'worker'.
function backupPanel(sk, who) {
  const b = h('button', { class: 'btn small ghost', type: 'button' }, 'Copy backup key');
  b.addEventListener('click', () => copy(sk, b));
  const worker = who === 'worker';
  return h('div', { class: 'panel' }, h('h2', {}, worker ? 'Back up your worker key' : 'Back up your organizer key'),
    h('p', { class: 'sub' }, worker
      ? 'This key is stored only in this browser. If this window is closed, its data cleared, or the pact is opened in another browser, the key is not there and you cannot claim your fee. Copy it now and keep it somewhere safe (for example a note).'
      : 'This key is stored only in this browser. If this window is closed or its data cleared, the key is gone and the money cannot be taken back. Copy it now and keep it somewhere safe (for example a note).'),
    h('div', { class: 'addr' }, sk), h('div', { class: 'row' }, b),
    h('p', { class: 'note' }, worker
      ? 'Keep it private. With it, the pact can be accepted, waived or claimed on your side. A claimed fee always goes to your payout address.'
      : 'Keep it private. With it, the pact can be cancelled; the money would go to your refund address, not to the holder of the key.'));
}

function newPact() {
  const err = h('p', { class: 'err', role: 'alert' });
  const f = { name: h('input', { id: 'name', maxlength: 60, placeholder: 'Saturday event, Main Hall', autocomplete: 'off' }),
    fee: h('input', { id: 'fee', inputmode: 'decimal', placeholder: '0.002', autocomplete: 'off' }),
    end: h('input', { id: 'end', type: 'datetime-local' }),
    addr: h('input', { id: 'addr', placeholder: `${NET === 'mainnet' ? 'bitcoincash:q…' : 'bchtest:q…'}`, autocomplete: 'off', spellcheck: 'false' }) };
  const out = h('div');
  const usd = h('div', { class: 'hint' }, `At least ${fmtBch(MIN_FEE_SAT)} BCH.`);
  const showUsd = () => { let v = 0; try { v = Number(parseBch(f.fee.value)); } catch { /* typing in progress */ }
    usd.textContent = usdRate && v > 0 ? `≈ $${(v / 1e8 * usdRate).toFixed(2)} at today’s rate. At least ${fmtBch(MIN_FEE_SAT)} BCH.` : `At least ${fmtBch(MIN_FEE_SAT)} BCH.`; };
  f.fee.addEventListener('input', showUsd); rateReady.then(showUsd);
  const chip = (label, d) => { const b = h('button', { class: 'chip', type: 'button' }, label); b.addEventListener('click', () => { f.end.value = localInput(d); }); return b; };
  const at = (days, hh, mm) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hh, mm, 0, 0); return d; };
  const chips = [['Tonight 23:59', at(0, 23, 59)], ['Tomorrow 02:00', at(1, 2, 0)], ['Tomorrow 23:59', at(1, 23, 59)]]
    .filter(([, d]) => d.getTime() - Date.now() > 75 * 60_000).map(([l, d]) => chip(l, d));
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Create pact request');
  const form = h('form', { class: 'card', novalidate: true },
    h('label', { for: 'name' }, 'What is the gig?'), f.name,
    h('label', { for: 'fee' }, 'Your fee (BCH)'), f.fee, usd,
    h('label', { for: 'end' }, 'When does the event end?'), h('div', { class: 'chips' }, ...chips), f.end, h('div', { class: 'hint' }, 'You can claim your fee after this time, and you have 7 days to do it.'),
    h('label', { for: 'addr' }, 'Your BCH address (where the money goes)'), f.addr,
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
      if (!store.put(binToHex(pkW), binToHex(sk), { role: 'W', th: termsOf(p, false) })) throw new UiError('This browser would not let the app save your signing key, so the pact cannot be created. Allow site storage and try again.');
      const code = encodePact(p), url = `${location.origin}${location.pathname}#/pact/${code}`;
      out.replaceChildren(h('div', { class: 'panel', style: 'margin-top:22px' },
        h('h2', {}, 'Send this link to the organizer'),
        h('p', { class: 'sub' }, 'They open it, enter their refund address, and get the address to fund. Nothing is locked until they pay. After they fund, they send you back a different link. Open that one to accept.'),
        h('div', { class: 'addr' }, url),
        h('div', { class: 'row' }, (() => { const b = h('button', { class: 'btn small', type: 'button' }, 'Copy link'); b.addEventListener('click', () => copy(url, b)); return b; })(), link(`#/pact/${code}`, 'Open it here', 'btn small ghost')),
        h('p', { class: 'note' }, 'Your signing key for this pact is stored in this browser only. Do not clear this site’s data until the pact is settled, and open the organizer’s reply link in this same browser.'),
        backupPanel(binToHex(sk), 'worker')));
      btn.textContent = 'Create another';
    } catch (x) { err.textContent = x instanceof UiError ? x.message : `Something went wrong: ${x.message}`; btn.textContent = 'Create pact request'; }
    btn.disabled = false;
  });
  app.replaceChildren(h('div', { class: 'wrap' }, top(), h('h2', {}, 'Create a pact'), h('p', { class: 'sub' }, 'Four quick answers. You get a link to send to the organizer.'), form, out));
}

// Has this lock ever received money (including unconfirmed)? null when the server could not answer.
async function everUsed(lock) {
  try { const sh = binToHex(sha256.hash(lock).reverse()); const hist = await provider.performRequest('blockchain.scripthash.get_history', sh); return Array.isArray(hist) ? hist.length > 0 : null; } catch { return null; }
}

async function pactScreen(code) {
  resetWalletListeners();
  const wrap = h('div', { class: 'wrap' }, top());
  app.replaceChildren(wrap);
  let p; try { p = decodePact(code); } catch (x) { wrap.append(h('p', { class: 'err' }, x.message), link('#/', 'Back to start')); return; }
  try { checkNumbers(p); } catch (x) { wrap.append(h('p', { class: 'err' }, `This pact has terms that cannot work: ${x.message}`)); return; }
  const pkW = binToHex(p.pkW), mineW = store.find(pkW), pkVhex = p.pkV && binToHex(p.pkV), mineV = pkVhex && store.find(pkVhex);
  // The key record remembers the terms that were entered in THIS browser. A link that differs (someone changed the fee, the payout
  // address, the end block, ...) is refused: the role key alone must never be enough to trust a link.
  if ((mineW?.th && termsOf(p, false) !== mineW.th) || (mineV?.th && p.pkV && termsOf(p, true) !== mineV.th)) {
    wrap.append(h('p', { class: 'err' }, 'This link does not match what was entered when this pact was created in this browser: the fee, the end, the name or an address was changed. Do not use it. Ask for the original link.'), link('#/', 'Back to start'));
    return;
  }
  const fillEta = () => etaText(p.tEnd).then((t) => document.querySelectorAll('.eta').forEach((e) => { e.textContent = t; }));

  if (!p.pkV) { // organizer, step 1: refund address -> V key -> funding address
    if (mineW) { // the worker opened their own request link: it is meant for the organizer
      const own = `${location.origin}${location.pathname}#/pact/${code}`;
      wrap.append(h('div', { class: 'grid2' }, h('div', { class: 'panel' }, h('h2', {}, 'This is your request link'),
        h('p', { class: 'sub' }, 'Send it to the organizer. They open it, enter a refund address and get the address to fund. Nothing is locked until they pay.'),
        h('div', { class: 'addr' }, own), h('div', { class: 'row' }, (() => { const b = h('button', { class: 'btn small', type: 'button' }, 'Copy link'); b.addEventListener('click', () => copy(own, b)); return b; })()),
        h('p', { class: 'note' }, 'This link never changes. After the organizer funds the pact, they send you a different, longer link. Open that one to accept, or paste it below.'),
        (() => {
          const input = h('input', { placeholder: 'Paste the organizer’s link here', autocomplete: 'off', spellcheck: 'false' }), msg = h('p', { class: 'err', role: 'alert' });
          const go = h('button', { class: 'btn small', type: 'button' }, 'Open the pact');
          go.addEventListener('click', () => {
            msg.textContent = '';
            const v = input.value.trim(), i = v.indexOf('#/pact/'), c = i >= 0 ? v.slice(i + 7) : v;
            let q; try { q = decodePact(c); } catch { msg.textContent = 'That is not a pact link.'; return; }
            if (!q.pkV) { msg.textContent = 'That is still your own request link. Wait for the organizer’s reply link.'; return; }
            location.hash = `#/pact/${c}`;
          });
          return h('div', {}, input, msg, h('div', { class: 'row' }, go));
        })()),
        pass(p, { state: 'Waiting for the organizer’s reply', stateClass: 'warn', seed: code })));
      fillEta();
      return;
    }
    const id = pactId(code), reqKey = `gigpact.req.${id}`;
    try { const again = localStorage.getItem(reqKey); if (again) { location.hash = `#/pact/${again}`; return; } } catch { /* first time */ }
    const err = h('p', { class: 'err', role: 'alert' });
    const addr = h('input', { id: 'refund', placeholder: `${NET === 'mainnet' ? 'bitcoincash:q…' : 'bchtest:q…'}`, autocomplete: 'off', spellcheck: 'false' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Get the funding address');
    const form = h('form', { class: 'card', novalidate: true },
      h('h2', {}, 'You are the organizer'), h('p', { class: 'sub' }, 'Pay the fee into this pact before the gig. If the worker never accepts, you can take it back. Before you pay, check with the worker, by another channel, that the payout address on the card is theirs.'),
      h('label', { for: 'refund' }, 'Your refund address (BCH)'), addr, h('div', { class: 'hint' }, 'If the pact is cancelled or settled in your favour, the money returns here.'), err, h('div', { class: 'row' }, btn));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      try {
        const lockV = parseAddress(addr.value);
        if (p.F < MIN_FEE_SAT) throw new UiError(`The fee in this request is below the minimum of ${fmtBch(MIN_FEE_SAT)} BCH. Ask the worker for a new link.`);
        let t; try { t = await tip(); } catch { throw new UiError('Could not reach the Bitcoin Cash network to read the current block. Check your connection and try again.'); }
        if (p.tEnd < t + MIN_LEAD_BLOCKS) throw new UiError('The event end in this request is already too close or in the past. Ask the worker for a new link.');
        const sk = newKey(), pkV = pubOf(sk);
        const full = { ...p, pkV, lockV };
        chainFor(full, provider); // throws if the terms are not allowed
        if (!store.put(binToHex(pkV), binToHex(sk), { role: 'V', th: termsOf(full, true) })) throw new UiError('This browser would not let the app save your signing key. Allow site storage and try again.');
        try { localStorage.setItem(reqKey, encodePact(full)); } catch { /* display only */ }
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
  const setState = (txt, cls, d) => { statusEl.textContent = txt; statusEl.className = `state ${cls}`; detail.textContent = d ?? ''; const c = wrap.querySelector('.pass .state'); if (c) { c.textContent = txt; c.className = `state ${cls}`; } };
  // Pay box: BIP21-style URI with the exact amount, as QR and as copyable text. Only shown while nothing has arrived yet.
  const payUri = `${fundAddr}?amount=${fmtBch(p.F)}`;
  const payCopy = h('button', { class: 'btn small ghost', type: 'button' }, 'Copy funding address');
  payCopy.addEventListener('click', () => copy(fundAddr, payCopy));
  const payBox = h('div', { class: 'panel', hidden: true },
    h('h2', {}, 'Pay this pact'), h('p', { class: 'sub' }, `Scan with a wallet app to pay exactly ${fmtBch(p.F)} BCH in one payment. Check the amount in the wallet before you confirm.`),
    h('div', { class: 'qr' }, qrSvg(qrFor(payUri))), h('div', { class: 'addr' }, fundAddr), h('div', { class: 'row' }, payCopy));
  // Remember (in this browser) that this pact was settled, so a reload does not look like "waiting for funding".
  const doneKey = `gigpact.done.${pactId(code)}`;
  const doneMark = () => { try { return JSON.parse(localStorage.getItem(doneKey) || 'null'); } catch { return null; } };
  const markDone = (r) => { try { localStorage.setItem(doneKey, JSON.stringify({ path: r.path, txid: r.txid, to: r.to })); } catch { /* display only */ } };
  let wp = null, cp = null, sp = null, sp2 = null, kb = null;
  // The funding box (address + copy button) is only useful before the money moved on; after that it could lead to a second payment.
  // gone = the pact moved on, hide the whole box; funded = the funding is on the network, hide only the address and the copy button.
  function fundGone(gone, funded = false) { if (role === 'organizer') { roleBox.hidden = gone; fundPay.hidden = funded; fundDone.hidden = !funded; fundTitle.textContent = funded ? 'Pact funded' : 'Fund this pact'; } }
  // Once the pact is finished (settled, cancelled, or the address already used) the organizer key has nothing left to protect.
  const keyDone = (done) => { if (kb) kb.hidden = done; };
  async function refresh() {
    try {
      payBox.hidden = true; keyDone(false);
      const A = chain.addresses;
      const [us, acc, later] = await Promise.all([utxosAt(A.funded), utxosAt(A.accepted), Promise.all([A.requested, A.d100, A.d50].map((a) => utxosAt(a)))]);
      cp?.setHeld(us);
      // The pact money is the one plain output of exactly F at a stage address. Anyone can send a small payment to any address,
      // so other outputs ("strays") are ignored when deciding the stage; they never hide a way out.
      const exactOf = (l) => l.filter((u) => u.satoshis === p.F && !u.token);
      const fx = exactOf(us), ax = exactOf(acc), rx = exactOf(later[0]), dx = exactOf(later[1]).length + exactOf(later[2]).length;
      const acceptedNow = ax.length === 1 && fx.length === 0 && rx.length === 0 && dx === 0;
      const claimed = rx.length === 1 && fx.length === 0 && ax.length === 0 && dx === 0;
      sp?.setAccepted(acceptedNow);
      sp2?.setAccepted(claimed);
      if (claimed) { setState('Claimed', 'ok', `The worker claimed the pay after the event. The money waits at the claim stage (${rx[0].txid}:${rx[0].vout}). After 432 blocks (about 3 days) it can be collected.`); wp?.setFunded(false, true); fundGone(true); return; }
      if (acceptedNow) { setState('Accepted', 'ok', `The worker accepted. Pact money is locked at ${ax[0].txid}:${ax[0].vout}`); wp?.setFunded(false, true); fundGone(true); return; }
      if (ax.length || rx.length || dx) { setState('Past the funded stage', 'warn', 'This pact has moved on to a stage this build does not show.'); wp?.setFunded(false); fundGone(false); return; }
      if (fx.length === 1) {
        // Accept spends the funding output; a worker who accepts on a 0-conf funding could be fooled by a replaced payment. Wait for 1 confirmation.
        let conf = null; try { conf = confirmedFrom(await provider.performRequest('blockchain.scripthash.listunspent', binToHex(sha256.hash(chain.locks.funded).reverse())), fx[0].txid, fx[0].vout); } catch { conf = null; }
        if (conf === false) { setState('Waiting for 1 confirmation', 'warn', `The funding payment is on the network (${fx[0].txid}:${fx[0].vout}) but not in a block yet. The worker can accept after the first confirmation, usually within about 10 minutes.`); wp?.setFunded(false, false, false, true); fundGone(false, true); return; }
        setState('Funded', 'ok', `Funding found on chain: ${fx[0].txid}:${fx[0].vout}${us.length > 1 ? ` (${us.length - 1} other small output(s) at the address are ignored)` : ''}`); wp?.setFunded(true); fundGone(false, true);
      }
      else if (us.length === 0 && doneMark()) { const d = doneMark(); if (d.path === 'F2') setState('Cancelled', 'warn', `The organizer cancelled before the worker accepted. The money went back to ${d.to}. Transaction ${d.txid}. Do not pay this pact again.`); else setState('Settled', 'ok', `This pact was settled (${d.path}). Transaction ${d.txid}. The money went to ${d.to}.`); wp?.setFunded(false, true, true); fundGone(true); keyDone(true); return; }
      else if (us.length === 0) {
        const used = await everUsed(chain.locks.funded);
        if (used === false) { setState('Waiting for funding', 'warn', 'Nothing has arrived at the funding address yet.'); wp?.setFunded(false); fundGone(false); payBox.hidden = false; return; }
        if (used === true) { setState('Already used', 'warn', 'Money already passed through this pact address and none is left in it. Do not pay it again. Create a new pact for a new gig.'); wp?.setFunded(false, true, true); fundGone(true); keyDone(true); return; }
        setState('Waiting for funding', 'warn', 'Nothing was found at the funding address. The history could not be checked, so the pay box is hidden.'); wp?.setFunded(false); fundGone(false); return;
      }
      else { setState('Funding needs a look', 'bad', `Found ${us.length} output(s) at the address (${us.map((u) => u.satoshis).join(', ')} sat). Exactly one output of ${p.F} sat is expected.`); wp?.setFunded(false); fundGone(false); }
    } catch { setState('Cannot check the chain', 'bad', 'The network did not answer. Retrying.'); }
  }
  // Key backup (organizer) and restore (a browser without the key). The key lives only in this browser's storage, so a closed private
  // window or cleared site data loses it for good: without it the money at the funding address cannot be taken back.
  const keyBox = () => backupPanel(role === 'worker' ? mineW.sk : mineV.sk, role);
  const restoreBox = () => {
    const input = h('input', { placeholder: 'Backup key (64 characters)', autocomplete: 'off', spellcheck: 'false' });
    const err = h('p', { class: 'err', role: 'alert' });
    const b = h('button', { class: 'btn small', type: 'button' }, 'Restore key');
    b.addEventListener('click', () => {
      err.textContent = '';
      const k = input.value.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(k)) { err.textContent = 'The backup key is 64 characters (0-9 and a-f).'; return; }
      let pk; try { pk = binToHex(pubOf(hexToBin(k))); } catch { err.textContent = 'That is not a valid key.'; return; }
      const restoredRole = pk === pkVhex ? 'V' : pk === pkW ? 'W' : null;
      if (!restoredRole) { err.textContent = 'This key does not belong to this pact.'; return; }
      if (!store.put(pk, k, { role: restoredRole })) { err.textContent = 'This browser would not let the app save the key. Allow site storage and try again.'; return; }
      route();
    });
    return h('div', { class: 'panel' }, h('h2', {}, 'Do you have a backup key?'), h('p', { class: 'sub' }, 'If you saved the backup key of this pact (organizer or worker), paste it here to get your controls back.'), input, err, h('div', { class: 'row' }, b));
  };
  const sendBack = `${location.origin}${location.pathname}#/pact/${code}`;
  // Funding box of the organizer. The address and the copy button are only shown while nothing was paid: once the funding is on the
  // network a second payment would sit next to the first one, and the worker's accept would be refused until one is cancelled.
  const fundTitle = h('h2', {}, 'Fund this pact');
  const fundPay = h('div', {}, h('p', { class: 'sub' }, `Send exactly ${fmtBch(p.F)} BCH to this address, in one payment, from any wallet:`),
    h('div', { class: 'addr' }, fundAddr), h('div', { class: 'row' }, (() => { const b = h('button', { class: 'btn small', type: 'button' }, 'Copy address'); b.addEventListener('click', () => copy(fundAddr, b)); return b; })()),
    h('p', { class: 'note' }, 'Send it as ONE payment of the exact amount. Anything else at this address is not counted as the fee.'));
  const fundDone = h('p', { class: 'note', hidden: true }, 'The funding was found. Do not pay this pact again: a second payment would be locked too.');
  const roleBox = role === 'organizer'
    ? h('div', { class: 'panel' }, fundTitle, fundPay, fundDone,
        h('p', { class: 'note' }, 'After funding, send the worker this same page link so they can accept:'),
        h('div', { class: 'addr' }, sendBack), h('div', { class: 'row' }, (() => { const b = h('button', { class: 'btn small ghost', type: 'button' }, 'Copy link for the worker'); b.addEventListener('click', () => copy(sendBack, b)); return b; })()))
    : role === 'worker'
      ? (wp = workerPanel({ pact: p, keyW: hexToBin(mineW.sk), onDone: () => refresh() })).el
      : h('div', {}, h('div', { class: 'panel' }, h('h2', {}, 'Pact overview'), h('p', { class: 'sub' }, 'This browser holds no key for this pact, so it is read-only here. If you are the worker, open this link in the browser where you created the request, or restore your backup key below.')), restoreBox());
  // A3 only moves the money to the next stage; every other path ends the pact, so only those leave a marker.
  const finished = (r) => { if (r?.path !== 'A3') markDone(r); refresh(); };
  const rk = role === 'viewer' ? null : hexToBin((role === 'organizer' ? mineV : mineW).sk);
  if (role !== 'viewer') sp = settlePanel({ pact: p, role, key: rk, onDone: finished });
  sp2 = settlePanel({ pact: p, role, stage: 'requested', key: rk, onDone: finished });
  if (role === 'organizer') cp = cancelPanel({ pact: p, keyV: hexToBin(mineV.sk), onDone: (r) => { if (r?.txid) markDone({ path: 'F2', txid: r.txid, to: r.refundTo }); refresh(); } });
  wrap.append(h('div', { class: 'grid2' }, h('div', {}, roleBox, ...(sp ? [sp.el] : []), sp2.el, ...(role !== 'viewer' ? [(kb = keyBox())] : []), ...(cp ? [cp.el] : []), h('p', { style: 'margin-top:14px' }, statusEl), detail,
    h('p', { class: 'note' }, 'Funding address of this pact: ', h('code', {}, fundAddr.replace(/^[a-z]+:/, '').slice(0, 14) + '…')), payBox), pass(p, { state: 'Pact', stateClass: '', seed: fundAddr })));
  fillEta(); refresh(); timers.push(setInterval(refresh, 20000));
}

// ---- router ----------------------------------------------------------------------------------------------------
export function route() {
  stopTimers();
  const hash = location.hash.replace(/^#/, '') || '/';
  const m = hash.match(/^\/pact\/([A-Za-z0-9_-]+)$/);
  if (hash === '/new') newPact(); else if (m) pactScreen(m[1]).catch(() => { app.replaceChildren(h('div', { class: 'wrap' }, top(), h('p', { class: 'err' }, 'Something went wrong while opening this pact. Reload the page. If it keeps happening, ask for a new link.'), link('#/', 'Back to start'))); });
  window.scrollTo(0, 0);
}
export const stop = stopTimers;
