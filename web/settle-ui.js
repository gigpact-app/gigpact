// Panel for the Accepted stage: the organizer pays the worker (A1); the worker can waive (A2) or, after the event ends, claim (A3).
// All text through textContent.
import { h } from './dom.js';
import { walletBox } from './wallet-ui.js';
import { settlePact } from './accept.js';
import { provider } from './net.js';
import { addressOf } from './pact.js';

const ACTIONS = {
  organizer: [{ path: 'A1', label: 'Pay the worker now', help: (p) => `Releases the money to the worker's payout address ${addressOf(p.lockW)}. Use it when the work is done.` }],
  worker: [
    { path: 'A3', label: 'Claim the pay (after the event ends)', help: (p) => `Possible once the chain has reached block ${p.tEnd}. It moves the money to the claim stage.` },
    { path: 'A2', label: 'Waive: give the money back', help: (p) => `Returns the money to the organizer's refund address ${addressOf(p.lockV)}.`, ghost: true },
  ],
};

// role: 'organizer' | 'worker'. key: Uint8Array of that role. Returns { el, setAccepted(bool) }.
export function settlePanel({ pact, role, key, onDone }) {
  const el = h('div', { class: 'panel', hidden: true });
  let accepted = false, busy = false, done = null;
  const err = h('p', { class: 'err', role: 'alert' });
  const wb = walletBox({ onChange: () => render() });
  const stat = h('p', { class: 'sub' }, role === 'organizer' ? 'The worker accepted. When the work is done, pay the worker from here.' : 'You accepted. Later you can claim the pay here.');
  const btns = ACTIONS[role].map((a) => {
    const b = h('button', { class: a.ghost ? 'btn small ghost' : 'btn', type: 'button' }, a.label);
    b.addEventListener('click', async () => {
      const m = wb.mgr(); if (!m || !wb.isReady() || busy) return;
      busy = true; err.textContent = ''; render();
      try {
        const r = await settlePact({ pact, path: a.path, key, mgr: m, provider, onStep: (t) => wb.say(t) });
        done = r; wb.say(`Done. Transaction ${r.txid}. The money went to ${r.to}.`); onDone?.(r);
      } catch (x) { err.textContent = x?.message || String(x); wb.say(''); }
      busy = false; render();
    });
    return { a, b, note: h('p', { class: 'note' }, a.help(pact)) };
  });
  function render() {
    el.hidden = !accepted && !done;
    for (const x of btns) { x.b.disabled = !wb.isReady() || busy || !!done; x.b.hidden = !!done; x.note.hidden = !!done; }
  }
  el.append(h('h2', {}, role === 'organizer' ? 'Pay the worker' : 'Your options'), stat, wb.el, err, ...btns.flatMap((x) => [h('div', { class: 'row' }, x.b), x.note]));
  render();
  return { el, setAccepted(f) { accepted = !!f; render(); } };
}
