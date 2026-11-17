// Entry. Renders the home page from a small module and loads the app (wallet, contracts) only when a pact screen is opened.
import { renderHome } from './home.js';
import { h } from './dom.js';
import { normalizeHash } from './route.js';

const app = document.getElementById('app');
let appMod = null;
const loadApp = () => import('./app.js').then((m) => (appMod = m));

async function route() {
  // Clean the address bar first (trailing punctuation, unknown paths), without adding a history entry.
  const { hash } = normalizeHash(location.hash);
  const want = `#${hash}`;
  if (location.hash !== want && !(hash === '/' && !location.hash)) history.replaceState(null, '', want);
  if (hash === '/') { appMod?.stop(); renderHome(app); window.scrollTo(0, 0); return; }
  if (!appMod) { app.replaceChildren(h('div', { class: 'wrap' }, h('p', { class: 'sub', style: 'margin-top:48px' }, 'Loading…'))); try { await loadApp(); } catch { app.replaceChildren(h('div', { class: 'wrap' }, h('p', { class: 'err' }, 'Could not load the app. Check your connection and reload.'))); return; } }
  if (normalizeHash(location.hash).hash !== hash) return route();
  appMod.route();
}
window.addEventListener('hashchange', route);
route();
// Warm the app code in the background after the home page is on screen, so "Create a pact" opens at once.
if (!location.hash || location.hash === '#/') setTimeout(() => loadApp().catch(() => {}), 2500);
