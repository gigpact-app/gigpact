// Hash routing rules, kept apart from the screens so they are small and testable.
// A link pasted into a chat often gets punctuation glued to its end ("...#/pact/abc.", "(...)"): strip it. Anything that is not
// the start page, the new-pact form or a pact code falls back to the start page instead of leaving the page stuck on "Loading...".
const TRAIL = /[.,;:!?)\]}>"'\u2019\u201d]+$/;
export const PACT_RE = /^\/pact\/([A-Za-z0-9_-]+)$/;
export function normalizeHash(raw) {
  const hash = (String(raw).replace(/^#/, '') || '/').replace(TRAIL, '') || '/';
  if (hash === '/' || hash === '/new' || PACT_RE.test(hash)) return { hash, valid: true };
  return { hash: '/', valid: false };
}
