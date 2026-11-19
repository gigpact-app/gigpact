<!--
Second-model review of the four contracts. Raw output, kept unedited below the line.
Reviewer: Grok 4.7 (Medium effort) in the Cursor desktop app, an empty workspace with no access to this repository.
Date: 19 November 2026. Input: the four .cash sources and a short description of the design, pasted by the author.
This is a read-only review by an AI model from a different vendor than the one that wrote the code. It is NOT an independent audit.
Our own check of each finding, against the code and tests, is in docs/SECURITY-LIMITS.md.
Note: the reviewer saw only the contracts. It did not see the app, the transaction library or the tests.
-->

# GigPact CashScript 0.14.0 review

Handoff for another assistant. Read-only adversarial review of the four contracts below. Do not rewrite the project and do not add features. The question was where money can be stolen, locked, redirected, or released at the wrong time.

Contracts reviewed: `GigPactFunded.cash`, `GigPactAccepted.cash`, `GigPactRequested.cash`, `GigPactDispute.cash`.

Stated deployment constants: `dustSafe = 1000` sat, `dv = 432` blocks (~3 days, relative), `l = 2016` blocks (~14 days, relative), `G = 1008` blocks (7 days) so `tA4 = tEnd + G`. `tEnd` and `tA4` are absolute locktimes passed in the constructor (block heights or timestamps). `pkA` is a discarded demo key, so in practice every dispute ends on D4. The app does not offer C2 or A4 yet; those paths exist in the contracts.

Transaction shape shared by all four: input 0 is the contract UTXO; input 1 and optionally input 2 are plain BCH sponsor inputs that pay the miner fee, so output 0 can carry the full value `F`. At most one extra change output is allowed. Constructor arguments are fixed when the pact is created: `pkV`, `pkW` (role keys, not payout addresses), `lockV` and `lockW` (payout locking bytecodes), the next state's locking bytecode, `F`, times, and constants.

## Result

No third party, sponsor, or miner can redirect the fee on a pact whose constructor arguments match the stated rules. Output 0 is pinned on every path, and the splits add back to the same number of satoshis that entered. The losses that are real come from races the code explicitly allows, from constructor arguments the chain does not cross-check, and from key loss. There is no confirmed theft that breaks a correctly parameterized pact while both role keys are present and the arbiter key is actually unknowable.

## Findings

| id | contract.function | summary | severity | class |
|---|---|---|---|---|
| F1 | `Accepted.claim` / `Accepted.openDispute` | After `tA4`, the organizer can mine a phi=50 dispute ahead of the worker's claim and keep half | high | design limitation |
| F2 | `Funded.accept` and every later handoff | The chain does not check that the next bytecode, times, `phi`, `dv`, or `l` match the stated rules | high | design limitation |
| F3 | `Dispute.decideEmployer` (also D1, D3) | A discarded `pkA` is still a full arbiter in the bytecode | high | not sure |
| F4 | `Requested.complete` / `Requested.objectClaim` | The organizer can replace the 3-day payout with one 14-day wait; the worker still gets `F` if `pkA` is dead and `phi` is 100 | medium | design limitation |
| F5 | `Funded.cancel`, `Accepted.*` | Losing a role key does not freeze every stage, and Accepted has no unsigned escape | medium | design limitation |
| F6 | `Funded.cancel` | A below-dust refund is pinned to that amount, so relay can refuse it | low | real limitation, already commented |
| F7 | every function that allows one change output | The miner fee is uncapped, so a sponsor input with no change is paid entirely to miners | low | design limitation |
| F8 | `Dispute.decideSplit`, `Dispute.fallback` | The odd satoshi goes to the organizer | info | real behavior, not a defect |
| F9 | comments / `disputeRefundLock` | A few names and comments describe a stricter rule than the code | info | comment mismatch |

### F1 — After `tA4` the organizer can force the 50% path

**Class:** design limitation. The stated rules give both `claim` and `openDispute` only a lower bound, and the Accepted comment says times are only a lower bound. The code matches that. It is still the way half the fee changes hands on an honestly parameterized pact.

`openDispute` is consensus-invalid while `tx.time < tA4`. From `tEnd` until `tA4` the organizer's only spend is `pay`, which sends the whole `F` to `lockW`. The worker's exclusive claim window is real.

Once the chain is past `tA4`, both spends are valid. First-seen is only relay policy. A miner may include either transaction, including one handed to the miner directly with a larger fee.

Organizer transaction, mineable in the first block whose height is greater than `tA4` (or once median time is past `tA4`, if those values are timestamps):

- version 2, `nLockTime = tA4`
- input 0: the Accepted UTXO, `nSequence` anything except `0xffffffff`, unlock with `openDispute(sigV)`
- input 1: organizer's plain BCH sponsor
- output 0: `disputeRefundLock`, value exactly `F`, no token
- output 1: sponsor change, no token

The worker's competing transaction is `claim(sigW)` with `nLockTime >= tEnd` and output 0 = `requestedLock` for value `F`.

If the organizer's transaction is the one that confirms, the worker's 100% path is gone. After `l` blocks (2016) anyone can broadcast `fallback` on that Dispute UTXO:

- version 2, input 0 `nSequence >= 2016`
- input 1: a plain sponsor
- output 0: `lockW`, value `floor(F/2)`
- output 1: `lockV`, value `F - floor(F/2)`

The worker loses the ceiling half. The organizer receives it at `lockV` with no worker signature and no arbiter signature. A worker who got `claim` confirmed before `tA4` is already in Requested, and this transaction cannot be built against that UTXO.

### F2 — The next contract is whatever bytes the constructor stored

**Class:** design limitation. Each function pins output 0 to the locking bytecode passed in at construction. It does not check that those bytes are a GigPact contract, that the keys and payout scripts match, or that `tA4 = tEnd + 1008` in the same locktime unit. Constructor arguments are fixed in the redeem script, so the spender cannot swap them later. The worker's `accept` signature is the only gate. The wallet was not available for this review, so it is unknown whether it rebuilds and compares that bytecode before signing.

Concrete theft, if the worker signs `accept` on a Funded UTXO whose `acceptedLock` is an Accepted contract whose `requestedLock` is the organizer's own `lockV` (or any script the organizer can spend):

1. Worker broadcasts `accept(sigW)`: input 0 the Funded UTXO, input 1 a sponsor, output 0 `acceptedLock` for value `F`. The script is satisfied because it only compares bytes.
2. After `tEnd`, worker broadcasts `claim(sigW)`: output 0 is `requestedLock` for value `F`.
3. Organizer spends that output with an ordinary wallet transaction.

The worker loses `F`. The same pattern works if `acceptedLock` itself is the organizer's payout script: the loss happens at step 1.

Concrete forced split, with no broadcast race, if `tA4` is already in the past and `tEnd` is still in the future (or `tA4` is a timestamp and `tEnd` is a height — `OP_CHECKLOCKTIMEVERIFY` rejects mixed types, so each check is independent):

- As soon as the worker has accepted, the organizer broadcasts `openDispute(sigV)` with `nLockTime >= tA4`.
- `claim` is still invalid.
- After 2016 blocks, `fallback` on phi = 50 pays `floor(F/2)` to `lockW` and the rest to `lockV`.

A third variant: `disputePayLock` is a Dispute instance with `phi = 50` instead of 100. The worker's `claim` is honest, the organizer's `objectClaim(sigV)` is valid, and `fallback` later splits. The worker loses half.

`this.age >= dv` is `OP_CHECKSEQUENCEVERIFY`. With the stated `dv = 432` and `l = 2016` the 16-bit mask does not change the wait. The contract does not require `1 <= dv <= 65535` or `1 <= l <= 65535`. Bit 31 set on that constant makes CSV succeed immediately (`SEQUENCE_LOCKTIME_DISABLE_FLAG` on the operand is defined as a no-op). A value such as 65536 masks to a 0-block lock. That is the same root cause: bad constructor arguments, accepted by the worker.

### F3 — `pkA` can still award the pot to the organizer

**Class:** not sure. The contracts still implement D1, D2, and D3. Nothing in the bytecode disables them after a key is thrown away. This review did not include the pubkey or any evidence about where the private key went. If nobody has it, these paths are dead and this is not a loss. If the demo private key still exists anywhere, it is a live arbiter.

Transaction, on a Dispute UTXO created by `objectClaim` or `openDispute`, with no age requirement:

- input 0: Dispute, unlock with `decideEmployer(sigA)`
- input 1: sponsor
- output 0: `lockV`, value `F - fA`
- output 1: `lockA`, value `fA`
- output 2: optional sponsor change

The worker loses `F - fA`. The organizer receives it. `fA` goes to `lockA`, which the signer collects only if they can spend `lockA`. `decideWorker` and `decideSplit` are the same shape with different output 0 / output 1 values. This can be done in the block the Dispute UTXO appears, before `fallback`.

### F4 — `objectClaim` can be mined in the same block as `claim`

**Class:** design limitation. This is the mechanism behind the known limit "D4 with phi = 100 pays the worker in full after an organizer objection when the arbiter does not act." The end state is right: with `phi = 100` and nobody able to sign as `pkA`, `fallback` pays the worker `F`. Two details are sharper than that sentence.

`objectClaim` has no timelock. It is valid in the same block as `claim` (child transaction, age 0) and it stays valid after `dv`. There is no second hop back to Requested, so the organizer gets one delay, not an infinite reset.

Organizer transaction:

- input 0: the Requested UTXO created by `claim`, `nSequence` final or not (this function does not use CSV or CLTV), unlock with `objectClaim(sigV)`
- input 1: sponsor
- output 0: `disputePayLock` (phi = 100), value `F`

Then, 2016 blocks after that Dispute output exists, anyone broadcasts `fallback`: one output, `lockW`, value `F`. The worker receives the full fee later than `dv`. They lose the time, not the satoshis, unless F3 is live or the worker signs `waive`.

On a first-seen relay path, a low-fee `objectClaim` broadcast before `complete` also occupies the UTXO until it confirms or drops. A miner can prefer `complete` anyway. `complete` itself, broadcast by a stranger, can only pay `lockW` for value `F`; a stranger cannot point it somewhere else. The worker can fee-bump a low-fee `complete` by spending the `lockW` output as a child.

### F5 — What a lost role key actually does

**Class:** design limitation. The sentence "a lost organizer key means funds at that stage cannot be taken back" is true only as "`pkV` can no longer sign a refund." `lockV` is a different key. The payout scripts cannot spend the covenant.

| Stage | `pkV` lost, `pkW` still signs | `pkW` lost, `pkV` still signs | both role keys lost |
|---|---|---|---|
| Funded | Worker can `accept`, then `claim`, then `complete`, and take `F`. Organizer cannot `cancel`. | Organizer `cancel`s to `lockV`. | Frozen. No unsigned path. |
| Accepted | Worker can `waive` to `lockV`, or after `tEnd` take the 100% path. Organizer cannot `openDispute`. | Organizer can `pay` to `lockW`, or after `tA4` force F1's split. If the organizer does nothing, the UTXO stays forever. | Frozen. |
| Requested | Anyone can `complete` after `dv`. Organizer cannot object. | Organizer can `objectClaim` or `payOut`. After `dv`, anyone can still `complete` if the organizer has not. | `complete` still pays `lockW` after `dv`. |
| Dispute | `fallback` still runs after `l`. | Same. | `fallback` still runs after `l`. |

Seizure transaction when only the organizer's role key is lost during Funded: the worker broadcasts `accept(sigW)`, waits until `tEnd`, broadcasts `claim(sigW)`, waits 432 blocks, broadcasts `complete()`. Output 0 of the last transaction is `lockW` for value `F`. The organizer loses the fee they can no longer cancel.

The freeze when both role keys are lost in Funded or Accepted needs no attacker. No function in those two contracts is spendable without `pkV` or `pkW`.

### F6 — `cancel` will not increase a tiny UTXO to dust

**Class:** real limitation, already stated in the G1-01 comment. `accept` cannot be called unless `F/2 >= dustSafe`, so an accepted pact has `F >= 2000` at `dustSafe` of 1000. `cancel` has no such floor.

Mistaken funding: Funded script, value 300. Recovery attempt:

- input 0: that UTXO, `cancel(sigV)`
- input 1: sponsor
- output 0: `lockV`, value exactly 300

The covenant forbids paying `lockV` more than 300, so the sponsor cannot top the output up to dust. Consensus will accept it; ordinary relay often will not. The organizer's sats sit until a miner includes a dust output.

### F7 — A one-output settlement gives the miner the whole sponsor input

**Class:** design limitation. Every function allows the short output count (`1`, or `2`/`3` on the split paths) and does not cap `sum(inputs) - sum(outputs)`.

Mistaken `pay` transaction:

- input 0: Accepted, value `F`, `pay(sigV)`
- input 1: a 1 BCH plain UTXO
- output 0: `lockW`, value `F`
- no output 1

The worker receives `F`. The miner receives the 1 BCH. The same shape exists on `complete` and `fallback`. The covenant amount is not reduced. The sponsor's signature has to cover that output list (`SIGHASH_ALL`) for this to be the transaction they actually authorized. The contract does not restrict the sighash flag. It does not need to for `F`, because the script re-checks output 0.

### F8 — Odd satoshi

**Class:** real behavior, not a defect. In `decideSplit`, `w = (F - fA) / 2` and `v = (F - fA) - w`. In `fallback` with `phi = 50`, `w = F / 2` and `v = F - w`. CashScript `/` truncates toward zero. For these positive amounts that is floor division, and `v >= w`. The extra satoshi is in the organizer's output. `w + v + fA = F` in D3, and `w + v = F` in D4. Nothing is left behind.

`require(w >= dustSafe)` also covers `v` whenever the inputs are positive. There is no pair where `w` passes dust and `v` does not.

### F9 — Comments that overshoot the code

**Class:** comment mismatch. No fund movement by itself.

- `disputeRefundLock` is the phi = 50 instance. `fallback` on it splits. It does not refund `F` to the organizer. The `openDispute` comment, which says phi = 50, matches the code.
- "phi is only 100 or 50" is enforced only inside `fallback`. D1, D2, D3, D5, and D6 do not read `phi`. A Dispute UTXO compiled with any other `phi` can still be settled by a signature, and `fallback` on it can never succeed.
- "Only an exactly funded UTXO passes" is true for `accept` (`F == fundedValue`). `cancel` spends any value. G1-01 says that second part explicitly.
- "Times only give a lower bound" matches F1. That comment is accurate.

## Known limits, checked against the code

- "D4 with phi = 100 pays the worker in full after an objection if the arbiter does not act" matches the code, with the timing in F4 and the exception in F3.
- "Keys live in the browser" is outside these four files. The contract will enforce whatever transaction those keys sign, including `waive` and including a large sponsor fee.
- The lost-organizer-key sentence should be replaced by the table in F5.
- "No independent audit yet" is not something the contract source can confirm or refute. This document is one pass over the four sources.

## Checked, and holding

**Signers and outputs.** Every function requires `this.activeInputIndex == 0` and either `checkSig` for the role named in the spec, or no signature where the spec says nobody signs (`complete`, `fallback`). Each function was compared with the A/C/D list; the pubkey and the destination bytecode match that list. Output 0's locking bytecode, satoshi value, and `tokenCategory` are pinned everywhere. On D1 and D2, outputs 0 and 1 are pinned and add to `F`. On D3, outputs 0, 1, and 2 are pinned and add to `F`. On D4 with phi = 50, outputs 0 and 1 are pinned and add to `F`. A sponsor, a miner, or a sighash of `NONE` / `ANYONECANPAY` / `SINGLE` does not loosen those `require`s; they read the executed transaction. The unpinned output is only the last change output. Input count is 2 or 3 on every function, including D1–D3. Output counts match the stated shape.

**Dust math on the path that actually goes through `accept`.** `accept` requires `F == fundedValue`, `fA >= dustSafe`, `4*fA <= F`, `F - fA >= 2*dustSafe`, and `F/2 >= dustSafe`. With `dustSafe > 0` and `fA >= dustSafe`, `F >= 4*fA` is the binding one, so the minimum fee is `4*fA` (4000 sats if `fA` is 1000). Those inequalities are enough for D1, D2, D3, and both D4 branches. The `4*fA` check is stricter than dust: `fA = 1000`, `F = 3000` would split cleanly and `accept` still rejects it. Non-terminal handoffs (`accept`, `claim`, `openDispute`, `objectClaim`) all require the next output value to equal the input value, so the floor established at `accept` is still true in Dispute. Terminal paths pay out exactly `F`. There is no shave and no dust trap on that path. `dustSafe = 1000` is above the usual 546-sat relay dust for a standard payout. Later contracts only re-check `F >= dustSafe` (or the split equivalent). Paying those addresses directly, outside the state machine, can create a UTXO that fails every branch. The four-state handoff does not do that.

**Time.** `tx.time >= tEnd` and `tx.time >= tA4` are `OP_CHECKLOCKTIMEVERIFY`. A final `nSequence` (`0xffffffff`) fails that opcode. A height compared with a timestamp fails it. Version 1 does not weaken it. `this.age >= dv` and `this.age >= l` are `OP_CHECKSEQUENCEVERIFY` on input 0; version below 2 fails, and the disable flag on the input's `nSequence` fails. With 432 and 2016, both fit the 16-bit block field, so the waits are about 3 days and about 14 days, measured from the block that created that UTXO, not from `tEnd`. `claim` does not start `dv`. `objectClaim` does not restart `l` a second time. CLTV becomes mineable in the block after a height locktime; that is one block, not a broken path.

**Tokens.** `tokenCategory == 0x` is the CashScript 0.14 empty value, including NFTs with a capability byte appended. Every allowed input is checked, and so is every output the function permits. An input with no token cannot fund a token output, and a genesis category is 32 bytes, so it fails the `0x` check. There is no mint, burn, or token attachment that spends these paths.

**Phi.** `phi` is a constructor argument, so it is part of the redeem script and of the locking-bytecode hash. A phi = 50 UTXO and a phi = 100 UTXO are different contracts. `fallback` then requires `phi == 100` or `phi == 50` and the `else` branch is only 50. The spender cannot pick the other behavior. Mixing them up is the construction mistake in F2: the parent stores the other instance's locking bytecode.

**Dead ends with honest parameters and one working role key.** None found. Funded can be accepted or cancelled. Accepted can be paid, waived, or, once the relevant time is reached, claimed or disputed. Requested can be completed after `dv`, or objected, paid, or waived. Dispute can be paid, waived, or after `l` settled by `fallback`, and D1–D3 remain only for `pkA`. The sponsor requirement matches the design: input 0's value is fully assigned to pinned outputs, so the fee has to come from input 1 or 2. Someone whose only coins are inside the pact cannot move it until they have a plain sponsor input.

## Open questions

- Whether the worker's software rebuilds the Accepted, Requested, and both Dispute locking bytecodes and compares them, and the keys, `lockV`, `lockW`, `fA`, `dustSafe`, `dv`, `l`, `tEnd`, and `tA4`, before it signs `accept`.
- Whether `tEnd` and `tA4` are heights or unix timestamps. Adding `G = 1008` is a 7-day gap only for heights. For timestamps, 7 days is 604800 seconds. The contracts will enforce whatever pair they are given.
- The numeric `fA` actually passed. `accept` rejects the UTXO unless `fA >= dustSafe` and `F >= 4*fA`, including when D1–D3 will never be used.
- Whether the demo private key for `pkA` is destroyed, and whether `lockA` is spendable by that same key.
- The four sources were not compiled here, so it is unknown whether the Dispute redeem script is inside standard relay size.
- The transaction builder was not reviewed. `complete` and `fallback` need version 2 and an input 0 sequence of at least `dv` or `l`. `claim` and `openDispute` need `nLockTime` at least the threshold and a non-final sequence. The CashScript SDK does that when the contract requires `tx.time` or `this.age`. A hand-built transaction has to do it itself.

## Semantics this review relied on

- CashScript 0.14: `require(tx.time >= n)` compiles to `OP_CHECKLOCKTIMEVERIFY`. Values below 500000000 are heights; values at or above it are timestamps.
- CashScript 0.14: `require(this.age >= n)` compiles to `OP_CHECKSEQUENCEVERIFY` on the active input. The SDK treats the sequence argument as blocks, not 512-second chunks.
- CashScript integer `/` truncates toward zero (same as floor for the positive amounts in D3 and D4).
- `tokenCategory` is `0x` when the input or output has no token. An NFT capability appends `0x01` or `0x02` to the 32-byte category, which still fails `== 0x`.
- Bitcoin Cash relay is first-seen, not replace-by-fee. A conflicting spend can still be mined if a miner sees it and chooses it. That is policy, not consensus.
- `OP_CHECKSEQUENCEVERIFY` treats a script operand with bit 31 set as a success with no relative lock. The low 16 bits are the block count. Bit 22 selects 512-second units.
