# Pre-hackathon declaration

GigPact is built by one person (Ozan Turan, GitHub `Oziman13`) for BCH BLAZE 2026. This page says what existed before the hackathon and what did not.

## What existed before kick-off (14 November 2026)

- **Architecture planning and documentation** for a payment guarantee for live-event workers on Bitcoin Cash (roles, states, the idea of spend paths, parameters).
  - This planning material is not part of the repository and is not offered as evidence of anything. Everything that is judged here (contracts, app, tests, documents) was written after kick-off and can be checked in the git history.
- **Standalone technical compatibility experiments** to learn whether the planned approach was possible: CashScript, and WizardConnect pairing/signing with Paytaca and Selene.
  - These were throwaway test scripts, not a product.
  - **They are not copied into this repository.** No code from them is in the submission.
  - They only answered feasibility questions (can the contract be built with CashScript; can a WizardConnect wallet such as Paytaca or Selene pair and sign). Their results informed the plan; they did not produce any product code.

## What did NOT exist before kick-off

- No GigPact product repository.
- No GigPact contract source, transaction library, web app or tests.
- No live demo and no pre-hackathon demo link. (There is therefore no "old repo" to list.)
- No mainnet transaction of GigPact.

## What was built during the hackathon

Everything in this repository: the four CashScript contracts, the transaction library, the WizardConnect signing and verification module, the web app, the tests and the evidence notes. The first commit of this repository is `1de0af3`, dated 14 November 2026, 19:50 (UTC+3), after the kick-off. The commit history is public and shows the order of work.

## Tools used

- AI assistants helped with drafting code, tests and documentation (Claude) with an independent read-only review of the text (Gemini) and with a read-only review of the four contract sources (Grok 4.7 in Cursor, 19 November; a second opinion, not an audit: `docs/SECURITY-LIMITS.md`). The author started every step, ran the tests on his own machine, signed every wallet transaction himself and decided what is published. Reviews are recorded in `docs/G1-BOUNDARIES.md` with their limits (for example, a review that only reads text does not reproduce test results).
- Third-party libraries: CashScript 0.14.0, libauth, `@wizardconnect/core` 0.2.10 and `@wizardconnect/dapp` 0.2.7 (LGPL-3.0, used as unmodified npm packages), `qrcode-generator`, Vite.

## What is not claimed

See the "What is tested" table in the README. In short: only the accept (F1), pay (A1), cancel (F2), claim-after-event (A3), waive after accepting (A2), organizer pays at the claim stage (C3) and waive at the claim stage (C4) paths have run with a real wallet on mainnet (docs/evidence/M1 to M6), by one tester playing both roles. With Selene (17 November, docs/evidence/M7) the fund, accept (F1) and pay (A1) paths have run, again with both roles played by one tester.
