// App configuration. Network: mainnet unless ?net=chipnet is in the URL (development only).
export const NET = new URLSearchParams(location.search).get('net') === 'chipnet' ? 'chipnet' : 'mainnet';
export const PREFIX = NET === 'mainnet' ? 'bitcoincash' : 'bchtest';
export const FA = 2000n; // arbiter fee fA (sat), default of the architecture (K12: fA <= F/4)
// Demo arbiter: a public key whose private key was generated once and NEVER stored or shown, so nobody can decide a dispute with it.
// It only matters for the dispute paths (P1, closed in this UI). Replace with a real arbiter key before dispute paths are opened.
export const ARBITER_PK = '0397ea49320bea869b7c18ec5eff57e7bf4beb119c13534fad9250df19d065b05a';
export const MIN_FEE_SAT = 10000n;       // UI minimum fee for a gig (contract minimum is 8,000 sat with fA = 2,000)
export const MIN_LEAD_BLOCKS = 6;        // the event end must be at least ~1 hour away

// Links shown in the home page banner (hackathon rule). PRESENTATION_URL must be shared publicly by the author before judging.
export const REPO_URL = 'https://github.com/gigpact-app/gigpact';
export const PRESENTATION_URL = 'https://claude.ai/artifact/EwUz88Njp9BfpEuuD4QYts';
export const DECLARATION_URL = `${REPO_URL}/blob/main/docs/DECLARATION.md`;
export const BEFORE_AFTER_URL = `${REPO_URL}/blob/main/docs/BEFORE-AFTER.md`;
// CashTokens-capable address for EMBER2026 donations (Community Choice). Copied from the author's wallet on 16 Nov 2026.
export const TOKEN_ADDR = 'bitcoincash:zpgcz25vg4f2rqd95qgs5qquwkzcuumy6g5lhutl8r';
