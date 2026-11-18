// Worker panel: connect a wallet (QR), then accept the pact. All text through textContent.
import { h, copy, qrSvg } from './dom.js';
import { connect, current, disconnect, hasStoredWallet, qrFor, reconnectNote } from './wallet.js';
import { acceptPact, walletCoins } from './accept.js';
import { WC_PATHS } from '../src/wizard.mjs';
import { addressOf, parseAddress } from './pact.js';
import { encodeLockingBytecodeP2pkh, hash160 } from '@bitauth/libauth';
import { provider } from './net.js';

// pact: decoded pact. keyW: Uint8Array. Returns { el, setFunded(bool, accepted?, finished?, pending?) }; pending = the funding is on the network but has no confirmation yet.
export function workerPanel({ pact, keyW, onDone }) {
  const el = h('div', { class: 'panel' });
  let funded = false, accepted = false, finished = false, pending = false, busy = false, wstate = 'idle', pairBox = null;
  let feeNote = null;
  const err = h('p', { class: 'err', role: 'alert' });
  const stepEl = h('p', { class: 'note' });
  const stat = h('p', { class: 'sub' });
  const connBtn = h('button', { class: 'btn small', type: 'button' }, 'Connect wallet');
  const accBtn = h('button', { class: 'btn', type: 'button' }, 'Accept the pact');
  const discBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Use another wallet');
  const slot = h('div');
  const checkEl = h('p', { class: 'note' });
  const finderBox = h('div');

  function render() {
    const ready = wstate === 'ready';
    stat.textContent = finished ? 'This pact is finished: the money has left the pact address. Nothing more to do here.'
      : accepted ? 'You accepted this pact. The money is now locked for you until the event ends.'
      : pending ? 'The funding is on the network and waits for 1 confirmation (usually within about 10 minutes). You can connect your wallet meanwhile.'
      : !funded ? 'Waiting for the organizer to fund the pact. You can connect your wallet meanwhile.'
      : ready ? 'The pact is funded and your wallet is connected.' : 'The pact is funded. Connect your wallet to accept it.';
    connBtn.hidden = ready || wstate === 'connecting' || accepted || !!pairBox;
    discBtn.hidden = !(ready || wstate === 'connecting' || pairBox) || accepted;
    accBtn.hidden = accepted; accBtn.disabled = !(funded && ready) || busy;
    if (ready && pairBox) { pairBox.remove(); pairBox = null; }
    if (ready && !finderBox.firstChild) finderBox.append(finder());
    if (!ready) finderBox.replaceChildren();
    // A finished pact has nothing left to connect or accept: hide the wallet status, the wallet check and the fee note.
    for (const x of [stepEl, checkEl, finderBox, feeNote]) if (x) x.hidden = finished;
  }
  function onWallet(s, me) {
    wstate = s === 'pairing' ? (pairBox ? 'pairing' : 'idle') : s;
    if (s === 'ready') { stepEl.textContent = `Connected to ${me.mgr.walletName || 'your wallet'}.`; walletCheck(me); }
    else if (s === 'connecting') reconnectNote(stepEl);
    else if (s === 'lost') stepEl.textContent = 'Connection to the wallet was lost. Trying again…';
    render();
  }
  // Read-only check after connecting: the first receive address derived from the wallet's public keys, and the coins found at the
  // first receive/change addresses. If these match what the wallet app shows, key derivation is right. Nothing is signed or sent.
  async function walletCheck(me) {
    try {
      const derive = (name, i) => me.mgr.getPubkey(WC_PATHS[name], BigInt(i));
      const pk = derive('receive', 0);
      if (!pk) { checkEl.textContent = 'Wallet check: the wallet shared no receive keys.'; return; }
      const first = addressOf(encodeLockingBytecodeP2pkh(hash160(pk)));
      checkEl.textContent = `Wallet check: first receive address ${first}. Looking for coins…`;
      const coins = await walletCoins({ derive, getUtxos: (a) => provider.getUtxos(a) });
      const total = coins.reduce((a, c) => a + c.satoshis, 0n);
      checkEl.textContent = `Wallet check: first receive address ${first}. Plain coins this wallet can sign for: ${coins.length} (${total} sat). Looked at ${coins.scanned} addresses; ${coins.failed} lookups failed; ${coins.tokenOutputs} token outputs skipped. Compare the address with your wallet app.${coins.length === 0 && !coins.failed ? ' No plain Bitcoin Cash was found, so accepting would fail: the wallet needs about 0.00004 BCH of its own to pay the network fee.' : ''}`;
    } catch (x) { checkEl.textContent = `Wallet check failed: ${x?.message || x}`; }
  }
  // Diagnostic: find which shared key (path/index) belongs to an address the user copied from their wallet app. Pure computation.
  function finder() {
    const input = h('input', { placeholder: 'bitcoincash:q… (copy it from your wallet app)' });
    const out = h('p', { class: 'note' });
    const btn = h('button', { class: 'btn small ghost', type: 'button' }, 'Find this address in the wallet keys');
    btn.addEventListener('click', () => {
      out.textContent = '';
      const me = current(); if (!me || wstate !== 'ready') { out.textContent = 'Connect the wallet first.'; return; }
      let lock; try { lock = parseAddress(input.value); } catch (x) { out.textContent = x.message; return; }
      const MAX = 300;
      for (const name of ['receive', 'change', 'defi']) {
        for (let i = 0; i < MAX; i++) {
          const pk = me.mgr.getPubkey(WC_PATHS[name], BigInt(i));
          if (pk && same(encodeLockingBytecodeP2pkh(hash160(pk)), lock)) { out.textContent = `Found: ${name} index ${i}.`; return; }
        }
      }
      out.textContent = `Not found in the first ${MAX} indexes of receive, change and defi. The wallet shares keys for: ${(me.mgr.getSessionPaths?.() ?? []).map((p) => p.name ?? p.pathName ?? '?').join(', ') || 'unknown paths'}.`;
    });
    return h('div', { class: 'row' , style: 'flex-direction:column;align-items:stretch;gap:8px' }, input, btn, out);
  }
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  function showPairing(me) {
    const uri = me.uri;
    const copyBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Copy connection link');
    copyBtn.addEventListener('click', () => copy(uri, copyBtn));
    pairBox = h('div', { class: 'pairing' },
      h('p', { class: 'note' }, 'Open the WizardConnect menu in your wallet and scan this code. Paytaca: "Initiate new WizardConnect session". Selene: Wallet > Wallet tools > WizardConnect.'),
      h('div', { class: 'qr' }, qrSvg(qrFor(me.qrUri))),
      h('div', { class: 'row' }, copyBtn, h('a', { class: 'btn small ghost', href: uri }, 'Open in wallet app')),
      h('p', { class: 'note' }, 'The code only sets up an encrypted channel. Your wallet will ask you before anything is signed.'));
    slot.replaceChildren(pairBox);
  }
  connBtn.addEventListener('click', () => {
    err.textContent = ''; stepEl.textContent = 'Waiting for your wallet…'; wstate = 'pairing';
    const me = connect(onWallet, { fresh: true }); showPairing(me); render();
  });
  discBtn.addEventListener('click', () => { disconnect(true); pairBox = null; slot.replaceChildren(); wstate = 'idle'; stepEl.textContent = ''; render(); });
  accBtn.addEventListener('click', async () => {
    const c = current(); if (!c || wstate !== 'ready' || !funded || busy) return;
    busy = true; err.textContent = ''; render();
    try {
      const r = await acceptPact({ pact, keyW, mgr: c.mgr, provider, onStep: (t) => { stepEl.textContent = t; } });
      accepted = true; stepEl.textContent = `Done. Transaction ${r.txid}`;
      onDone?.(r);
    } catch (x) { err.textContent = x?.message || String(x); stepEl.textContent = ''; }
    busy = false; render();
  });

  el.append(h('h2', {}, 'You are the worker'), stat,
    h('div', { class: 'row' }, connBtn, discBtn), slot, stepEl, checkEl, finderBox, err,
    h('div', { class: 'row' }, accBtn),
    h('p', { class: 'note' }, 'Accepting costs only the network fee (a few hundred satoshi), paid from your wallet. The pact money stays in the pact; no one can take it outside the pact rules. The connected wallet needs a small balance of its own to cover that fee: about 0.00004 BCH (a few thousand satoshi) is enough.'));
  feeNote = el.lastElementChild;
  if (hasStoredWallet()) { wstate = 'connecting'; connect(onWallet); }
  render();
  return { el, setFunded(f, acc, fin, pend) { funded = !!f; pending = !!pend; if (acc) accepted = true; if (fin) finished = true; render(); } };
}
