// WizardConnect (hdwalletv1) connection, dapp side. One session per browser; it is kept in localStorage by the library
// (key "gigpact.wc") so a reload reconnects without a new QR code. The relay only carries encrypted messages.
import { DappConnectionManager } from '@wizardconnect/dapp';
import { initiateDappRelay } from '@wizardconnect/core';
import qrcode from 'qrcode-generator';

const SESSION_KEY = 'gigpact.wc';
let cur = null; // { mgr, relay, uri, qrUri, state }
// Every panel on a page subscribes here. A page has several wallet boxes; they share ONE connection (a second connect() used to tear the
// first one down and send a disconnect message to the wallet, so only the last box ever became ready).
const listeners = new Set();
export const resetWalletListeners = () => listeners.clear();

export const hasStoredWallet = () => { try { const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return !!(s && s.walletPublicKey); } catch { return false; } };
export const current = () => cur;

// A stored session that the wallet does not answer must not show "Reconnecting…" for ever: after a while say what the person can do.
const RECONNECT_TEXT = 'Reconnecting to your wallet…';
const STUCK_TEXT = 'Your wallet is not answering. Open the wallet app and wait a moment, or choose "Use another wallet" to pair again.';
export function reconnectNote(stepEl, ms = 25000) {
  stepEl.textContent = RECONNECT_TEXT;
  setTimeout(() => { if (stepEl.textContent === RECONNECT_TEXT) stepEl.textContent = STUCK_TEXT; }, ms);
}

export function qrFor(text) { const q = qrcode(0, 'L'); q.addData(text); q.make(); return q; }

// onChange(state, info): state = 'pairing' | 'connecting' | 'ready' | 'lost'
export function connect(onChange, { fresh = false } = {}) {
  if (!fresh && cur) { if (onChange) { listeners.add(onChange); onChange(cur.state, cur); } return cur; }
  disconnect(false);
  if (onChange) listeners.add(onChange);
  const mgr = new DappConnectionManager('GigPact', undefined, { session: { key: SESSION_KEY } });
  let existing; const stored = mgr.loadStoredSession();
  if (stored && stored.walletPublicKey) existing = { privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey };
  const me = { mgr, relay: null, uri: '', qrUri: '', state: existing ? 'connecting' : 'pairing' };
  const set = (s) => { me.state = s; for (const f of [...listeners]) { try { f(s, me); } catch { /* one box must not stop the others */ } } };
  const relay = initiateDappRelay(({ client, status }) => {
    mgr.updateConnection(client, status);
    if (status.status === 'reconnecting' || status.status === 'disconnected') { if (me.state === 'ready') set('lost'); }
  }, existing ? { existingCredentials: existing } : {});
  me.relay = relay; me.uri = relay.uri; me.qrUri = relay.qrUri;
  mgr.attachRelay(relay);
  if (existing && stored.paths?.length) { try { mgr.restoreSessionPaths(stored.paths); } catch { /* wallet_ready will refill */ } }
  mgr.on('walletready', () => set('ready'));
  mgr.on('disconnect', () => { set('pairing'); });
  mgr.on('reconnecting', () => { if (me.state === 'ready') set('lost'); });
  cur = me; for (const f of [...listeners]) { try { f(me.state, me); } catch { /* see above */ } }
  return me;
}

export function disconnect(clear = true) {
  if (!cur) return;
  const c = cur; cur = null;
  if (clear) { try { c.mgr.sendDisconnect?.().catch(() => {}); } catch { /* courtesy message only, and only when the user ends the session */ } }
  try { c.relay.cleanup(); } catch { /* ignore */ }
  if (clear) { try { c.mgr.clearStoredSession(); } catch { /* ignore */ } for (const f of [...listeners]) { try { f('pairing', c); } catch { /* ignore */ } } }
}
