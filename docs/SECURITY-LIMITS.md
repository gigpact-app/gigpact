# Security and limits

GigPact is a prototype for small amounts. It has **no independent audit**. This page lists what was reviewed, what the reviews found, and what we checked ourselves. The contract sources are unchanged since the first mainnet run, because every mainnet proof is tied to their bytecode.

## What was reviewed

| Review | By | Scope | Output |
|---|---|---|---|
| Code, tests, documentation | Claude (the author's assistant) | everything | the repository |
| Text review | Gemini | documents only | recorded in [G1-BOUNDARIES.md](G1-BOUNDARIES.md) |
| Contract review, 19 Nov 2026 | Grok 4.7 (Medium) in Cursor, an empty workspace | the four `.cash` sources and a short description | [second-model-review-grok-4.7.md](reviews/second-model-review-grok-4.7.md), raw and unedited |
| Contract review, 19 Nov 2026 | DeepSeek, web chat, file upload | the four `.cash` sources, the description and the real parameter values | [second-model-review-deepseek.md](reviews/second-model-review-deepseek.md), raw and unedited |
| Second round, 19 Nov 2026 | DeepSeek, web chat, file upload, new prompt | the four `.cash` sources plus the transaction library: `src/chain.mjs`, `src/spend.mjs`, `src/wizard.mjs`, `src/errors.mjs`, `web/pact.js`, `web/config.js` | [second-model-review-deepseek-2-code.md](reviews/second-model-review-deepseek-2-code.md), raw and unedited |

The Grok and DeepSeek reviews are read-only passes by models from other vendors. They are second opinions, **not audits**. The first two reviewers saw only the contracts. The second DeepSeek round also saw the transaction library, but not `src/k17.mjs`, the browser UI, the chain provider or the key storage, and not the tests. The prompt of the first DeepSeek review is in [reviews/review-prompt.md](reviews/review-prompt.md) (Grok got the same text without the paragraph of real parameter values); the prompt of the second round is in [reviews/review-prompt-2.md](reviews/review-prompt-2.md).

## Result of the second-model reviews

Both reviews reach the same conclusion. No third party, sponsor or miner can redirect the fee of a correctly parameterized pact: output 0 is pinned on every path and the splits add back to the amount that went in. The losses it describes come from races the code allows on purpose, from constructor arguments the chain does not cross-check, and from key loss.

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

## Second review (DeepSeek): what repeats and what is new

Repeats: the constructor arguments are not bound on chain (Grok F2); the organizer can delay the worker by objecting just before the collect (Grok F4); the sub-dust cancel (F6, not reachable with a fee of at least 8,000 sat); the odd satoshi (F8). Both direct questions get a plain yes with the exact transaction sequence: if the organizer does nothing after the worker accepted, the worker collects (accept, claim after the event end, collect after 432 blocks); before the accept the organizer recovers the fee with the cancel. The one caveat is inherent: if the worker's accept confirms first, the cancel is no longer possible.

New and our check:

| # | Finding (short) | Our check | Status |
|---|---|---|---|
| D1 | A funding output that carries a CashToken can never be spent, because every path requires token-free inputs | Confirmed for the contracts. In the app: the organizer page counts only an exact, token-free output as funding, the worker page refuses a funding output with a token ("The funding output carries a token, which this pact does not accept."), and spending requires token-free contract and sponsor inputs (`web/app.js`, `web/accept.js`, `src/spend.mjs`). Reaching it needs a token-aware wallet that attaches a token on purpose or by mistake; the loss is the organizer's own. | Known limit, small |
| D2 | Whether the sponsor inputs are signed with SIGHASH_ALL | Yes, the library rejects any sponsor signature that is not hash type 0x61 (ALL, FORKID, UTXOS) and compares the signed transaction with the expected one before it is used (`verifySigned` in `src/wizard.mjs`, tests in `test/wizard.test.mjs`). | Answered |

Each review found something the others did not: Grok the claim / dispute race after T_A4 and the lost-key cases, DeepSeek the token-bearing funding output and, in the second round, the missing amount check on later spends. None found a way to take money from a correctly parameterized pact.

## Second DeepSeek round (contracts and transaction library): our check

The reviewer again found no way to take money from a correctly parameterized pact with only one role key outside the known timing cases, and found no hole in `verifySigned` (a wallet that returns a different transaction is rejected). Its findings, checked against the code:

| # | Finding (short) | Our check | Status |
|---|---|---|---|
| F-1 | A pact link is not signed, so someone who changes it in transit can swap the worker key and payout address | True as stated: the link is plain data, and the payout address is not bound to the key. By design the organizer is told on the page to confirm the worker's payout address with the worker through another channel before funding, and a swapped link shows a different address. This check is by a person, not by code. An optional short check code shown on both pages is not built. | Known limit, partly covered |
| F-2 | Only the first spend (F1) checks that the coin has the agreed amount; every later spend takes the amount from whatever coin the provider shows | Real, small. The reviewer did not get `src/k17.mjs`, which does the F1 check. For the other paths the library now refuses a coin whose value is not the agreed amount, except the cancel path F2 (code `UtxoValue`, new test with a decoy coin). It cannot make a hiding provider show the real coin. | Fixed in the library |
| F-3 | The library and the link accept an event end in the past; `MIN_LEAD_BLOCKS` looks unused | The constant is used in the browser UI (`web/app.js`, which the reviewer did not see) and the organizer page refuses a pact that starts less than 6 blocks before the end. The library alone does not check it. | False alarm for the app; library unchanged |
| F-4 | The link and the terms fingerprint do not include the fixed settings (arbiter fee, grace, waits, dust, arbiter key) | True. Changing one of them changes every contract address, so a pact funded under older settings could not be rebuilt by the new build. Rule: do not change `web/config.js` constants while pacts are open. | Known limit, rule written here |
| F-5 | The code only tests `type === 'p2pkh'`, so token-aware addresses may not be refused | libauth reports a token-aware address as a different type (`p2pkhWithTokens`), so it is refused. | False alarm |
| F-6 | The plan object holds byte arrays that can still be changed | Only code in the same page could do that; a wallet answer cannot. | Info |
| F-7 | Local signing uses one key for all sponsor inputs | Only the local test path; the wallet path signs per sponsor. | Info |
| F-8 | The fee error message names the wrong dust floor for P2SH32 change | Text only. | Info |

The reviewer also states, rightly, that all chain data comes from the provider: the app reads two Electrum servers one at a time and does not compare their answers. A provider that lies can hide a coin or delay a spend; it cannot move money, because the transaction is signed by the keys and checked before it is sent.

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
