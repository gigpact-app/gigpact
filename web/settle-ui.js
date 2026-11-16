// Panel for one stage. Accepted: the organizer pays the worker (A1); the worker can waive (A2) or, after the event ends, claim (A3).
// Requested (after a claim): the organizer can pay at once (C3); the worker can waive (C4) or, after the waiting period, collect (C1).
// All text through textContent.
import { h } from './dom.js';
import { walletBox } from './wallet-ui.js';
import { settlePact } from './accept.js';
import { provider } from './net.js';
import { addressOf } from './pact.js';

const ACTIONS = {
  accepted: {
    organizer: [{ path: 'A1', label: 'Pay the worker now', help: (p) => `Releases the money to the worker's payout address ${addressOf(p.lockW)}. Use it when the work is done.` }],
    worker: [
      { path: 'A3', label: 'Claim the pay (after the event ends)', help: (p) => `Possible once the chain has reached block ${p.tEnd}. It moves the money to the claim stage.` },
      { path: 'A2', label: 'Waive: give the money back', help: (p) => `Returns the money to the organizer's refund address ${addressOf(p.lockV)}.`, ghost: true },
    ],
  },
  requested: {
    organizer: [{ path: 'C3', label: 'Pay the worker now', help: (p) => `The worker claimed the pay. Releases the money to the worker's payout address ${addressOf(p.lockW)}.` }],
    worker: [
      { path: 'C1', label: 'Collect the pay (after the waiting period)', help: (p) => `Possible when the money has waited 432 blocks (about 3 days) at the claim stage. Pays your payout address ${addressOf(p.lockW)}.` },
      { path: 'C4', label: 'Waive: give the money back', help: (p) => `Returns the money to the organizer's refund address ${addressOf(p.lockV)}.`, ghost: true },
    ],
  },
};
const STAT = {
  accepted: { organizer: 'The worker accepted. When the work is done, pay the worker from here.', worker: 'You accepted. Later you can claim the pay here.' },
  requested: { organizer: 'The worker claimed the pay after the event. You can still pay now. Otherwise the worker can collect after the waiting period.', worker: 'You claimed the pay. The money waits at the claim stage. When the waiting period is over you can collect it here.' },
};

// role: 'organizer' | 'worker'. key: Uint8Array of that role. Returns { el, setAccepted(bool) }.
export function settlePanel({ pact, role, stage = 'accepted', key, onDone }) {
  const el = h('div', { class: 'panel', hidden: true });
  let accepted = false, busy = false, done = null;
  const err = h('p', { class: 'err', role: 'alert' });
  const wb = walletBox({ onChange: () => render() });
  const stat = h('p', { class: 'sub' }, STAT[stage][role]);
  const btns = ACTIONS[stage][role].map((a) => {
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
  el.append(h('h2', {}, stage === 'requested' ? 'Claimed: waiting period' : (role === 'organizer' ? 'Pay the worker' : 'Your options')), stat, wb.el, err, ...btns.flatMap((x) => [h('div', { class: 'row' }, x.b), x.note]));
  render();
  return { el, setAccepted(f) { accepted = !!f; render(); } };
}
