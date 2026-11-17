# Before / After

This page compares the state at hackathon kick-off (14 November 2026) with the state of this repository now (16 November 2026). The BCH BLAZE project presentation (made with the official template) is linked from the banner at the top of the app's home page.

| Topic | Before (kick-off) | After (now) |
|---|---|---|
| Idea | On paper: a payment guarantee for live-event and stage workers, with an architecture plan | Working prototype: the fee is locked on Bitcoin Cash before the gig and moves only along the contract rules |
| Contracts | None | Four CashScript contracts (Funded, Accepted, Requested, Dispute), 16 spend paths, compiled with cashc 0.14.0 |
| Transaction library | None | Chain building with address checks, funding rule (one declared funding outpoint), spend planning with a fee cap |
| Wallet | Standalone compatibility experiments with Paytaca and Selene (not part of this repository) | WizardConnect pairing in the app; Paytaca and Selene signed the sponsor input of the accept (F1) and pay (A1) transactions |
| Web app | None | Create a request, fund it with a QR code, accept with a wallet, pay out or take the money back |
| Mainnet | None | One full run of fund, accept, pay: three confirmed transactions (blocks 977,601 / 977,601 / 977,604) |
| Tests | None | 228 tests (contract VM, library, web logic) plus regtest tests on a local BCHN node |
| Paths run with a real wallet on mainnet | None | F1, A1, F2, A3, A2, C3 and C4 only |
| Paths not yet run with a real wallet | All | A4, C1, C2, D1-D6 (regtest: A4, C1, C2, D1-D6) |

## What did not change

- The core promise: money is locked before the gig and moves only along the contract rules.
- The scope: one gig, one worker, one fee, Bitcoin Cash only.

## What is still open

- A real-wallet run of collect after the waiting period (C1, planned about 19 Nov). Cancel (F2), claim-after-event (A3), waive after accepting (A2), organizer pays at the claim stage (C3) and waive at the claim stage (C4) have run: see docs/evidence/M2 to M6.
- Selene was verified for funding, accept (F1) and pay (A1) only (docs/evidence/M7); its other paths were not run.
- Disputes use a discarded demo arbiter key and are closed in the UI.
- No independent audit.
