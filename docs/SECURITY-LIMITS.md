# Security and limits

GigPact is a prototype for small amounts. It has **no independent audit**. This page lists what was reviewed, what the reviews found, and what we checked ourselves. The contract sources are unchanged since the first mainnet run, because every mainnet proof is tied to their bytecode.

## What was reviewed

| Review | By | Scope | Output |
|---|---|---|---|
| Code, tests, documentation | Claude (the author's assistant) | everything | the repository |
| Text review | Gemini | documents only | recorded in [G1-BOUNDARIES.md](G1-BOUNDARIES.md) |
| Contract review, 19 Nov 2026 | Grok 4.7 (Medium) in Cursor, an empty workspace | the four `.cash` sources and a short description | [docs/reviews/second-model-review-grok-4.7.md](reviews/second-model-review-grok-4.7.md), raw and unedited |

The Grok review is a read-only pass by a model from a different vendor. It is a second opinion, **not an audit**. The reviewer saw only the contracts, not the app, the transaction library or the tests.

## Result of the second-model review

No third party, sponsor or miner can redirect the fee of a correctly parameterized pact: output 0 is pinned on every path and the splits add back to the amount that went in. The losses it describes come from races the code allows on purpose, from constructor arguments the chain does not cross-check, and from key loss.

## Findings and our check

| # | Finding (short) | Our check | Status |
|---|---|---|---|
| F1 | After T_A4 (7 days after the event end) the organizer can open a dispute before the worker claims and later split the fee 50/50 | Confirmed. This is the design: before T_A4 only the worker can claim, after it both can. The app has no dispute button, so it needs a hand-built transaction. The home page says the worker should claim within 7 days. | Known limit |
| F2 | The contracts store the next contract's bytecode and the time and lock constants, but do not check that they are the intended ones | Confirmed for the contracts (known as G1-03, written in `src/chain.mjs`). In the app the whole chain is rebuilt from the pact terms (`buildChain`, `assertChain`, I12), the worker's page only watches the address it computed itself, the signed transaction is compared with the expected one (`verifySigned`), `dv` and `l` must be 1 to 65,535 blocks, and the event end must be a block height. A fingerprint of the terms is kept next to each role key and a link with other terms is refused. Left open: someone using other software could sign a transaction toward other contracts; the fingerprint check does not run for a key record that has no fingerprint (for example an organizer key restored from a backup). | Known limit, small app gap |
| F3 | The demo arbiter key still works in the bytecode of the dispute contract | The public key is in `web/config.js`. No private key is anywhere in the repository. The comment there says the key was generated once and not kept; the repository cannot prove that. The dispute paths are not offered in the app. | Known limit, cannot be proven |
| F4 | The organizer can answer a claim with an objection; with no real arbiter the fallback pays the worker in full after 2016 blocks (about 14 days) | Confirmed. The worker gets the money later, not less. | Known limit |
| F5 | What a lost role key does | See the table below. | Wording refined |
| F6 | A refund of a UTXO below the dust limit can be refused by relay | Confirmed, already commented in the contract (G1-01). The app requires at least 0.0001 BCH. | Known limit |
| F7 | A transaction with no change output gives the whole sponsor input to the miner | Not possible from the app: it builds the change output and caps the fee rate (`MAX_FEE_RATE` in `src/spend.mjs`, tested in `test/lib.test.mjs`). A hand-built transaction could do it. | Outside the app |
| F8 | The odd satoshi goes to the organizer in a split | Confirmed, not a defect: nothing is lost. | None |
| F9 | A few comments describe a stricter rule than the code | Confirmed, comments only; the sources stay unchanged. | None |

The reviewer's open questions, answered from the repository: the event end and T_A4 are block heights (the library refuses anything else); the arbiter fee is 2,000 sat and the contract needs a fee of at least four times that (8,000 sat), the form asks for at least 0.0001 BCH (10,000 sat); the waits are 432 blocks (about 3 days) and 2016 blocks (about 14 days).

## What a lost key does

| Stage | Organizer key lost, worker key works | Worker key lost, organizer key works | Both keys lost |
|---|---|---|---|
| Funded | The worker can accept, claim after the event end and collect after the wait. The organizer cannot cancel. | The organizer cancels and gets the fee back. | Frozen, no path without a key. |
| Accepted | The worker can waive, or claim after the event end. The organizer cannot pay or open a dispute. | The organizer can pay, or after 7 days open a dispute. | Frozen. |
| Requested | Anyone can collect for the worker after 432 blocks. | The organizer can object or pay; after 432 blocks anyone can still collect. | Anyone can collect for the worker after 432 blocks. |
| Dispute | After 2016 blocks anyone can run the fallback. | Same. | Same. |

So "a lost organizer key means the funds at that stage cannot be taken back" is true for the organizer; the worker can still receive them. Funds are frozen for good only when both role keys are lost during Funded or Accepted.

## What is not covered

- No independent audit by a human reviewer.
- The mainnet proofs cover fund, accept, pay, cancel, claim, waive, and pay or waive at the claim stage. Collect after the wait, the objection and the dispute paths ran only on a local test chain and in contract tests.
- Wallets (Paytaca, Selene) are not part of this review.
- Keys live in the browser. Back them up with the box the app offers.
