// App configuration. Network: mainnet unless ?net=chipnet is in the URL (development only).
export const NET = new URLSearchParams(location.search).get('net') === 'chipnet' ? 'chipnet' : 'mainnet';
export const PREFIX = NET === 'mainnet' ? 'bitcoincash' : 'bchtest';
export const FA = 2000n; // arbiter fee fA (sat), default of the architecture (K12: fA <= F/4)
// Demo arbiter: a public key whose private key was generated once and NEVER stored or shown, so nobody can decide a dispute with it.
// It only matters for the dispute paths (P1, closed in this UI). Replace with a real arbiter key before dispute paths are opened.
export const ARBITER_PK = '0397ea49320bea869b7c18ec5eff57e7bf4beb119c13534fad9250df19d065b05a';
export const MIN_FEE_SAT = 10000n;       // UI minimum fee for a gig (contract minimum is 8,000 sat with fA = 2,000)
export const MIN_LEAD_BLOCKS = 6;        // the event end must be at least ~1 hour away
