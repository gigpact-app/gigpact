# GigPact

**Secure pay for every gig.**

> An organizer locks the agreed fee on Bitcoin Cash before the gig, so the stage worker is paid by the contract rules instead of by trust.

Built solo for BCH BLAZE 2026 (DoraHacks). Prototype on Bitcoin Cash **mainnet**. Use small amounts only; there is no independent audit.

- Repository: https://github.com/gigpact-app/gigpact
- Pre-hackathon declaration: [docs/DECLARATION.md](docs/DECLARATION.md)
- Before / After: [docs/BEFORE-AFTER.md](docs/BEFORE-AFTER.md)

## The flow (one flow, four steps)

1. **Request.** The worker enters the gig, the fee, the event end and a payout address, and gets a link for the organizer.
2. **Fund.** The organizer opens the link, enters a refund address and sends exactly the fee to the pact's funding address from any wallet. The money now sits in a contract.
3. **Accept.** The worker connects a wallet with WizardConnect and presses *Accept*. The fee is now bound to the worker. Before acceptance the organizer can take the money back.
4. **Settle.** After the gig the organizer presses *Pay the worker*. (By design the worker can also claim after the event end if the organizer stays silent; see the limits below.)

The contract has 16 spend paths (claim after the event, waive, disputes and more). The web app shows only what the person has to do next.

## A real example on mainnet

The happy path fund → accept → pay has run once on Bitcoin Cash mainnet with a real wallet (Paytaca, signing over WizardConnect), 10,000 sat, on 16 November 2026. All three transactions are confirmed:

| Step | Transaction | Block |
|---|---|---|
| Fund | [`6e715ef3…ccc86b4a`](https://3xpl.com/bitcoin-cash/transaction/6e715ef3ff155358cdcc1283bd5eeb194b9c6a51e4c679477fbeb205ccc86b4a) | 977,601 |
| Accept (F1) | [`e5d41659…fb39bb592b`](https://3xpl.com/bitcoin-cash/transaction/e5d41659ee5bba9393cf2b980a3b6dbd32f68910928a8902711b05fb39bb592b) | 977,601 |
| Pay (A1) | [`f03fc1ef…495ba163`](https://3xpl.com/bitcoin-cash/transaction/f03fc1ef4ddd8b007c3a109f608b96e999d0b95631575e9a66258ece495ba163) | 977,604 |

This is a test pact where the tester played both roles. It is shown so you can check the chain without a wallet. Details: [docs/evidence/M1-mainnet-F1.md](docs/evidence/M1-mainnet-F1.md), including an incident we kept in the record.

## What is tested, and at which level

Levels are kept separate on purpose.

| Level | What it covers |
|---|---|
| Real wallet + mainnet | **F1 accept and A1 pay only** (Paytaca via WizardConnect) |
| Regtest (BCHN 29.2.0, local) | Timing, dust, wrong-signer and wrong-amount rejections, dispute payouts (G3 a/b/c), F1 and A1 with a software-wallet-signed sponsor input (G4-a) |
| Software wallet / contract VM tests | All 16 paths build, sign and verify offline; wallet-misbehaviour cases are refused |
| Not tested on a real wallet or mainnet | F2 (cancel), A2 (waive), A3 (claim after event end), C1–C4, D1–D6 |
| Not verified | Selene as a wallet; token-carrying inputs; the dispute paths with a real arbiter (the app uses a discarded demo arbiter key, so disputes cannot be decided and are closed in the UI) |

`npm test` runs 222 tests (contract VM, library, web logic). Regtest tests need a local BCHN node (`npm run test:regtest`). Full notes: [docs/G1-BOUNDARIES.md](docs/G1-BOUNDARIES.md).

## Honest limits

- Funding is a plain send from any wallet. Sending a wrong amount cannot be accepted by the contract (it takes exactly the fee) and the money can only be taken back with the organizer's key.
- The organizer's key lives in the browser (localStorage). The app offers a backup box; if you lose the key and the browser data, the funds at that stage are locked. One test pact on mainnet is locked this way (30,000 sat, see the evidence file).
- The "Settled" display is a marker kept per browser. Another browser sees the chain state, not the marker.
- The description "if the organizer stays silent, the worker can claim after the event" is the contract design (A3). It passed regtest and software tests, but has not run on mainnet.
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
