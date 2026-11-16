// Reusable wallet connection box (QR pairing, reconnect, disconnect). All text through textContent.
import { h, copy, qrSvg } from './dom.js';
import { connect, current, disconnect, hasStoredWallet, qrFor } from './wallet.js';

// onChange(): called whenever the connection state changes. Returns { el, isReady(), mgr(), say(text) }.
export function walletBox({ onChange, connectLabel = 'Connect wallet to pay the fee' } = {}) {
  let wstate = 'idle', pairBox = null;
  const el = h('div');
  const slot = h('div'), stepEl = h('p', { class: 'note' });
  const connBtn = h('button', { class: 'btn small', type: 'button' }, connectLabel);
  const discBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Use another wallet');
  function render() {
    const ready = wstate === 'ready';
    connBtn.hidden = ready || wstate === 'connecting' || !!pairBox;
    discBtn.hidden = !(ready || wstate === 'connecting' || pairBox);
    if (ready && pairBox) { pairBox.remove(); pairBox = null; }
    queueMicrotask(() => onChange?.()); // never during construction: the caller's own variables are not ready yet
  }
  function onWallet(s, me) {
    wstate = s === 'pairing' ? (pairBox ? 'pairing' : 'idle') : s;
    if (s === 'ready') stepEl.textContent = `Connected to ${me.mgr.walletName || 'your wallet'}.`;
    else if (s === 'connecting') stepEl.textContent = 'Reconnecting to your wallet…';
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
  connBtn.addEventListener('click', () => { stepEl.textContent = 'Waiting for your wallet…'; wstate = 'pairing'; const me = connect(onWallet); showPairing(me); render(); });
  discBtn.addEventListener('click', () => { disconnect(true); pairBox = null; slot.replaceChildren(); wstate = 'idle'; stepEl.textContent = ''; render(); });
  el.append(h('div', { class: 'row' }, connBtn, discBtn), slot, stepEl);
  if (hasStoredWallet()) { wstate = 'connecting'; connect(onWallet); }
  render();
  return { el, isReady: () => wstate === 'ready', mgr: () => current()?.mgr, say: (t) => { stepEl.textContent = t; } };
}
