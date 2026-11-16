// WizardConnect (hdwalletv1) connection, dapp side. One session per browser; it is kept in localStorage by the library
// (key "gigpact.wc") so a reload reconnects without a new QR code. The relay only carries encrypted messages.
import { DappConnectionManager } from '@wizardconnect/dapp';
import { initiateDappRelay } from '@wizardconnect/core';
import qrcode from 'qrcode-generator';

const SESSION_KEY = 'gigpact.wc';
let cur = null; // { mgr, relay, uri, qrUri, state }

export const hasStoredWallet = () => { try { const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return !!(s && s.walletPublicKey); } catch { return false; } };
export const current = () => cur;

export function qrFor(text) { const q = qrcode(0, 'L'); q.addData(text); q.make(); return q; }

// onChange(state, info): state = 'pairing' | 'connecting' | 'ready' | 'lost'
export function connect(onChange) {
  disconnect(false);
  const mgr = new DappConnectionManager('GigPact', undefined, { session: { key: SESSION_KEY } });
  let existing; const stored = mgr.loadStoredSession();
  if (stored && stored.walletPublicKey) existing = { privateKey: stored.privateKey, secret: stored.secret, walletPublicKey: stored.walletPublicKey };
  const me = { mgr, relay: null, uri: '', qrUri: '', state: existing ? 'connecting' : 'pairing' };
  const set = (s) => { me.state = s; onChange?.(s, me); };
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
  cur = me; onChange?.(me.state, me);
  return me;
}

export function disconnect(clear = true) {
  if (!cur) return;
  const c = cur; cur = null;
  try { c.mgr.sendDisconnect?.().catch(() => {}); } catch { /* courtesy message only */ }
  try { c.relay.cleanup(); } catch { /* ignore */ }
  if (clear) { try { c.mgr.clearStoredSession(); } catch { /* ignore */ } }
}
