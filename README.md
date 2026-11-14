# GigPact

**Secure pay for every gig.**

GigPact is a payment guarantee for live-event and stage workers, built on Bitcoin Cash. The goal: an organizer locks the agreed fee on-chain before the gig, and the worker is paid by the contract rules, not by trust.

Built for BCH BLAZE 2026 (DoraHacks).

## Status

Early development. The hackathon build started on 14 November 2026 (kick-off day).

At the time of this first commit:
- No GigPact contract, UI, or demo exists yet.
- Nothing has been tested on mainnet.
- No wallet is claimed as supported yet. Wallet support will be listed here only after it is technically verified.

## Pre-hackathon work (declaration)

Pre-hackathon work consisted of architecture planning, documentation, and standalone technical compatibility experiments (CashScript, WizardConnect with Paytaca and Selene). No GigPact product repository, product code, or live product demo existed at kickoff. The submitted product implementation is being developed during the hackathon period.

Standalone experiment scripts are not copied into this repository.

## Planned scope

- CashScript escrow-style contract for a single gig, one worker, one fee
- WizardConnect wallet signing
- Minimal web UI with clear status messages
- Mainnet flow, only after the contract is tested and funds are explicitly approved

## License

MIT
