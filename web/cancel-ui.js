// Organizer panel: take the money back from the Funded address (F2). Connects a wallet only to pay the network fee.
// All text through textContent.
import { h, copy, qrSvg } from './dom.js';
import { connect, current, disconnect, hasStoredWallet, qrFor, reconnectNote } from './wallet.js';
import { cancelPact } from './accept.js';
import { addressOf } from './pact.js';
import { provider } from './net.js';

// pact: decoded pact (with lockV). keyV: Uint8Array. Returns { el, setHeld(list of utxos at the funding address, accepted) }.
export function cancelPanel({ pact, keyV, onDone }) {
  const el = h('div', { class: 'panel', hidden: true });
  let held = [], moved = false, busy = false, wstate = 'idle', pairBox = null;
  const err = h('p', { class: 'err', role: 'alert' });
  const stepEl = h('p', { class: 'note' });
  const stat = h('p', { class: 'sub' });
  const slot = h('div');
  const connBtn = h('button', { class: 'btn small', type: 'button' }, 'Connect wallet to pay the fee');
  const discBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Use another wallet');
  const goBtn = h('button', { class: 'btn', type: 'button' }, 'Cancel and take the money back');
  const refund = addressOf(pact.lockV);

  function render() {
    const ready = wstate === 'ready';
    const total = held.reduce((a, u) => a + u.satoshis, 0n);
    el.hidden = moved ? false : held.length === 0;
    stat.textContent = moved ? 'The money was returned to your refund address.'
      : `${held.length} output(s), ${total} sat, sit at the funding address. You can cancel and take them back to ${refund}. Only the network fee (a few hundred satoshi) is paid from the connected wallet.`;
    connBtn.hidden = ready || wstate === 'connecting' || moved || !!pairBox;
    discBtn.hidden = !(ready || wstate === 'connecting' || pairBox) || moved;
    goBtn.hidden = moved; goBtn.disabled = !ready || busy || held.length === 0;
    if (ready && pairBox) { pairBox.remove(); pairBox = null; }
  }
  function onWallet(s, me) {
    wstate = s === 'pairing' ? (pairBox ? 'pairing' : 'idle') : s;
    if (s === 'ready') stepEl.textContent = `Connected to ${me.mgr.walletName || 'your wallet'}.`;
    else if (s === 'connecting') reconnectNote(stepEl);
    else if (s === 'lost') stepEl.textContent = 'Connection to the wallet was lost. Trying again…';
    render();
  }
  function showPairing(me) {
    const copyBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Copy connection link');
    copyBtn.addEventListener('click', () => copy(me.uri, copyBtn));
    pairBox = h('div', { class: 'pairing' },
      h('p', { class: 'note' }, 'In Paytaca open the WizardConnect menu ("Initiate new WizardConnect session") and scan this code:'),
      h('div', { class: 'qr' }, qrSvg(qrFor(me.qrUri))),
      h('div', { class: 'row' }, copyBtn, h('a', { class: 'btn small ghost', href: me.uri }, 'Open in wallet app')),
      h('p', { class: 'note' }, 'The code only sets up an encrypted channel. Your wallet will ask you before anything is signed.'));
    slot.replaceChildren(pairBox);
  }
  connBtn.addEventListener('click', () => { err.textContent = ''; stepEl.textContent = 'Waiting for your wallet…'; wstate = 'pairing'; const me = connect(onWallet, { fresh: true }); showPairing(me); render(); });
  discBtn.addEventListener('click', () => { disconnect(true); pairBox = null; slot.replaceChildren(); wstate = 'idle'; stepEl.textContent = ''; render(); });
  goBtn.addEventListener('click', async () => {
    const c = current(); if (!c || wstate !== 'ready' || busy || held.length === 0) return;
    busy = true; err.textContent = ''; render();
    try {
      const r = await cancelPact({ pact, keyV, mgr: c.mgr, provider, onStep: (t) => { stepEl.textContent = t; } });
      moved = r.remaining === 0; stepEl.textContent = `Done. Transaction ${r.txid}. ${r.returned} sat go back to ${r.refundTo}.`;
      onDone?.(r);
    } catch (x) { err.textContent = x?.message || String(x); stepEl.textContent = ''; }
    busy = false; render();
  });
  el.append(h('h2', {}, 'Take the money back'), stat, h('div', { class: 'row' }, connBtn, discBtn), slot, stepEl, err, h('div', { class: 'row' }, goBtn),
    h('p', { class: 'note' }, 'This is the pact\'s escape hatch. It works while the money is still at the funding address, in other words before the worker has accepted.'));
  if (hasStoredWallet()) { wstate = 'connecting'; connect(onWallet); }
  render();
  return { el, setHeld(list) { held = list; render(); } };
}
