# Before / After

This page compares the state at hackathon kick-off (14 November 2026) with the state of this repository now (20 November 2026). The BCH BLAZE project presentation (made with the official template) is linked from the banner at the top of the app's home page.

| Topic | Before (kick-off) | After (now) |
|---|---|---|
| Idea | On paper: a payment guarantee for live-event and stage workers, with an architecture plan | Working prototype: the fee is locked on Bitcoin Cash before the gig and moves only along the contract rules |
| Contracts | None | Four CashScript contracts (Funded, Accepted, Requested, Dispute), 16 spend paths, compiled with cashc 0.14.0 |
| Transaction library | None | Chain building with address checks, funding rule (one declared funding outpoint), spend planning with a fee cap |
| Wallet | Standalone compatibility experiments with Paytaca and Selene (not part of this repository) | WizardConnect pairing in the app; Paytaca and Selene signed the sponsor input of the accept (F1) and pay (A1) transactions |
| Web app | None | Create a request, fund it with a QR code, accept with a wallet, pay out or take the money back |
| Mainnet | None | One full run of fund, accept, pay: three confirmed transactions (blocks 977,601 / 977,601 / 977,604). Repeated on 18 November with Paytaca on the current build: fund, accept, pay (docs/evidence/M7b). The 'waiting for 1 confirmation' gate was seen live and a cancel (F2) was repeated (docs/evidence/M7c) |
| Tests | None | 241 tests (contract VM, library, web logic) plus regtest tests on a local BCHN node |
| Paths run with a real wallet on mainnet | None | F1, A1, F2, A3, A2, C3, C4 and C1 (docs/evidence/M1 to M8) |
| Paths run on mainnet by script, not through the app | None | C2, D1, D2, D3, D5, D6 with local keys and a test arbiter key (docs/evidence/M9) |
| Paths not run on mainnet | All | A4 and D4 (about 7 and 14 days; regtest has run both) |

## What did not change

- The core promise: money is locked before the gig and moves only along the contract rules.
- The scope: one gig, one worker, one fee, Bitcoin Cash only.

## What is still open

- Cancel (F2), claim-after-event (A3), waive after accepting (A2), organizer pays at the claim stage (C3), waive at the claim stage (C4) and collect after the waiting period (C1) have run with a real wallet: see docs/evidence/M2 to M6 and M8. The objection and arbiter paths ran by script only (M9).
- Selene was verified for funding, accept (F1) and pay (A1) only (docs/evidence/M7); its other paths were not run.
- Disputes use a discarded demo arbiter key and are closed in the UI.
- No independent audit.
