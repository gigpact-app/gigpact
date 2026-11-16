# GigPact

**Secure pay for every gig.**

> An organizer locks the agreed fee on Bitcoin Cash before the gig, so the stage worker is paid by the contract rules instead of by trust.

Built solo for BCH BLAZE 2026 (DoraHacks). Prototype on Bitcoin Cash **mainnet**. Use small amounts only; there is no independent audit.

- Repository: https://github.com/gigpact-app/gigpact
- Pre-hackathon declaration: [docs/DECLARATION.md](docs/DECLARATION.md)
- Before / After: [docs/BEFORE-AFTER.md](docs/BEFORE-AFTER.md)

## Vision

**Built for musicians first. Made for every gig.**

Today GigPact is built for musicians and live-event workers: performers, sound and light technicians, stage crew. The goal is global: every event worker (DJs, dancers, actors, hosts, photographers and more), and then any sector where work is booked for a date and paid on completion. The contract is the same everywhere: the fee is locked before the work, and it moves only along fixed rules. Only the label on the job changes.

The first market is focused; the wider sectors are vision, not something this prototype has been tested on. The musician background of the author is a reason to understand the problem, not proof of market demand.

## The flow (one flow, four steps)

1. **Request.** The worker enters the gig, the fee, the event end and a payout address, and gets a link for the organizer.
2. **Fund.** The organizer opens the link, enters a refund address and sends exactly the fee to the pact's funding address from any wallet. The money now sits in a contract.
3. **Accept.** The worker connects a wallet with WizardConnect and presses *Accept*. The fee is now bound to the worker. Before acceptance the organizer can take the money back.
4. **Settle.** After the gig the organizer presses *Pay the worker*. If the organizer stays silent, the worker can claim after the event end and collect after a waiting period of 432 blocks (about 3 days); see the limits below.

The contract has 16 spend paths (claim after the event, waive, disputes and more). The web app shows only what the person has to do next.

## A real example on mainnet

The happy path fund → accept → pay has run once on Bitcoin Cash mainnet with a real wallet (Paytaca, signing over WizardConnect), 10,000 sat, on 16 November 2026. All three transactions are confirmed:

| Step | Transaction | Block |
|---|---|---|
| Fund | [`6e715ef3…ccc86b4a`](https://3xpl.com/bitcoin-cash/transaction/6e715ef3ff155358cdcc1283bd5eeb194b9c6a51e4c679477fbeb205ccc86b4a) | 977,601 |
| Accept (F1) | [`e5d41659…fb39bb592b`](https://3xpl.com/bitcoin-cash/transaction/e5d41659ee5bba9393cf2b980a3b6dbd32f68910928a8902711b05fb39bb592b) | 977,601 |
| Pay (A1) | [`f03fc1ef…495ba163`](https://3xpl.com/bitcoin-cash/transaction/f03fc1ef4ddd8b007c3a109f608b96e999d0b95631575e9a66258ece495ba163) | 977,604 |

This is a test pact where the tester played both roles. It is shown so you can check the chain without a wallet. Details: [docs/evidence/M1-mainnet-F1.md](docs/evidence/M1-mainnet-F1.md), including an incident we kept in the record. A second real-wallet run, the cancel path (F2, block 977,609), is in [docs/evidence/M2-mainnet-F2.md](docs/evidence/M2-mainnet-F2.md). The claim after the event end (A3, block 977,619) is in [docs/evidence/M3-mainnet-A3.md](docs/evidence/M3-mainnet-A3.md).

## What is tested, and at which level

Levels are kept separate on purpose.

| Level | What it covers |
|---|---|
| Real wallet + mainnet | **F1 accept, A1 pay, F2 cancel and A3 claim only** (Paytaca via WizardConnect) |
| Regtest (BCHN 29.2.0, local) | Timing, dust, wrong-signer and wrong-amount rejections, dispute payouts (G3 a/b/c), F1 and A1 with a software-wallet-signed sponsor input (G4-a) |
| Software wallet / contract VM tests | All 16 paths build, sign and verify offline; wallet-misbehaviour cases are refused |
| Not tested on a real wallet or mainnet | A2 (waive), A4, C1–C4 (C1, collect after 432 blocks, is planned for 19 Nov), D1–D6. Of these, regtest has run A4, C1, C2 and D1–D6; A2, C3 and C4 only ran in the contract VM and with a software wallet |
| Not verified | Selene as a wallet; token-carrying inputs; the dispute paths with a real arbiter (the app uses a discarded demo arbiter key, so disputes cannot be decided and are closed in the UI) |

`npm test` runs 223 tests (contract VM, library, web logic). Regtest tests need a local BCHN node (`npm run test:regtest`). Full notes: [docs/G1-BOUNDARIES.md](docs/G1-BOUNDARIES.md).

## Honest limits

- Funding is a plain send from any wallet. Sending a wrong amount cannot be accepted by the contract (it takes exactly the fee) and the money can only be taken back with the organizer's key.
- The organizer's key lives in the browser (localStorage). The app offers a backup box; if you lose the key and the browser data, the funds at that stage are locked. One test pact on mainnet is locked this way (30,000 sat, see the evidence file).
- The "Settled" and "Cancelled" displays are markers kept per browser. Another browser shows the chain state: a pact address that already received and spent money is shown as "Already used" (no pay box). Strays (small payments sent to a pact address by anyone) are ignored when the app decides the stage.
- The worker's signing key is also kept only in the browser (the organizer gets a backup box). A worker who loses it cannot waive or claim; the collect step (C1) needs no key and is offered to any browser once the waiting period is over.
- The silent-organizer path (claim after the event end, then collect after 432 blocks) is the contract design (A3, then C1). It passed regtest and software tests; see the evidence notes for any real-wallet run on mainnet.
- Time is counted in blocks, not clock time. The dates in the app are estimates (about 10 minutes per block), so the 432-block wait is about 3 days, give or take a few hours.
- No audit. Contract sources are frozen for the hackathon.

## Try it

You need a Bitcoin Cash wallet that supports WizardConnect (Paytaca was used for the tests) and a few thousand sat.

```
npm ci
npm test              # contract + library + web tests
npm run build:web
npm run preview:web   # serves http://127.0.0.1:4173
```

Open the page and create a request as the worker (minimum fee 10,000 sat). Open the link in a second browser window or profile as the organizer, fund the shown address with exactly that amount, then accept as the worker.

## Layout

- `contracts/` four CashScript contracts (Funded, Accepted, Requested, Dispute), compiled with cashc 0.14.0
- `src/` transaction library (chain building, K17 funding rule, spend planning, WizardConnect signing and verification)
- `web/` the browser app (Vite, vanilla JS)
- `test/` contract VM, library, web and regtest tests
- `docs/` boundaries, evidence, declaration, before/after

## License

MIT for this repository (see `LICENSE`). Runtime dependencies keep their own licenses; `@wizardconnect/core` and `@wizardconnect/dapp` are LGPL-3.0 and are used as unmodified npm packages.
