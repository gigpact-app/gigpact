<!--
Second-model review of the four contracts. Raw output, kept unedited below the line.
Reviewer: DeepSeek, web chat, file upload (the model version and the reasoning mode were not recorded).
Date: 19 November 2026. Input: docs/reviews/review-prompt.md (the four .cash sources and a description of the design with the real parameter values).
A first attempt, with the prompt pasted into the chat box, was cut off by the chat and the reviewer answered that it had no contracts; it was repeated with the file uploaded.
This is a read-only review by an AI model from a different vendor than the one that wrote the code. It is NOT an independent audit.
Our own check of each finding, against the code and tests, is in docs/SECURITY-LIMITS.md.
Note: the reviewer saw only the contracts. It did not see the app, the transaction library or the tests.
-->

## Findings

| ID | Contract.function | Summary | Severity | Type |
|---|---|---|---|---|
| F1 | All contracts / constructor args | Next-state locks, payout locks, role keys, `phi`, `fA`, `tEnd/tA4`, `dv/l` are trusted; the contracts do not bind them on-chain. A wrong/malicious builder can redirect funds or release them early. | Critical if misbuilt | Limitation / software-enforced |
| F2 | `GigPactRequested.objectClaim` | C2 has no upper time limit. Organizer can object just before C1 matures and force the worker into the `l = 2016` block D4 wait. | Medium | Design limitation / griefing delay |
| F3 | All contracts / token checks | A token-bearing funding UTXO is unspendable because every path requires `input0.tokenCategory == 0x`. | Medium | Design limitation / software must avoid |
| F4 | `GigPactFunded.cancel` | No value floor in F2; a sub-dust refund can be nonstandard. Under stated `F >= 8000`, not exploitable. | Low / Info | False alarm / acknowledged |
| F5 | `GigPactDispute.decideSplit`, `fallback` | Odd sat rounding gives the organizer the extra satoshi. | Info | False alarm |

---

## F1 — Constructor-supplied locks and parameters are not verified on-chain

**Contracts/functions:** all constructors, especially `acceptedLock`, `requestedLock`, `disputeRefundLock`, `disputePayLock`, `lockV`, `lockW`, `pkV/pkW`, `phi`, `fA`, `tEnd/tA4`, `dv/l`.

The contracts blindly compare `output0.lockingBytecode` to constructor bytes. They do not prove that those bytes are the correct next GigPact state, nor that `lockV/lockW` are controlled by `pkV/pkW`, nor that `tA4 >= tEnd`, nor that the two Dispute instances have the intended `phi`, nor that Dispute `fA` matches Funded `fA`.

Concrete bad-builder transactions:

1. If the builder sets `acceptedLock = lockW`, worker broadcasts F1 accept:  
   input 0 = Funded UTXO, input 1 = sponsor, `sigW`; output 0 = `lockW`, value `F`.  
   Worker receives `F` immediately after funding, before any event. Organizer loses.

2. If the builder sets `disputeRefundLock = lockV`, organizer broadcasts A4:  
   input 0 = Accepted UTXO, input 1 = sponsor, `sigV`, `nLocktime >= tA4`; output 0 = `lockV`, value `F`.  
   Organizer takes the full fee after `tA4`, bypassing Dispute. Worker loses.

3. If `disputeRefundLock` accidentally points to the `phi = 100` Dispute instance instead of `phi = 50`, organizer opens A4, then after `l` anyone broadcasts D4 fallback and worker gets full `F`. Organizer loses the intended split.

4. If `tA4 < tEnd`, organizer can open A4 before the worker may claim. After `l`, D4 with `phi = 50` splits `F/2` to worker and rest to organizer. Worker loses half compared with claiming after `tEnd`.

5. If `lockW` is not controlled by the worker, A1 pay / C1 / C3 / D5 send the fee to the wrong address. If `lockV` is not controlled by the organizer, cancel/refunds go wrong.

**Who loses what:** organizer or worker, depending on which constructor argument is wrong. **Severity:** critical if the builder is buggy or malicious. **Type:** not a direct on-chain bug in the contracts; it is a design limitation that the software building the chain must enforce.

The builder must enforce at least: correct next-state locking bytecodes; correct `phi` per path; `tA4 = tEnd + G` and `tA4 >= tEnd`; consistent `fA`; correct `lockV/lockW` ownership; correct `dv/l/dustSafe`; and token-free funding.

---

## F2 — Organizer can delay worker by objecting just before C1 matures

**Contract/function:** `GigPactRequested.objectClaim`.

Sequence:

1. Worker claims via A3: Accepted UTXO -> Requested UTXO value `F`.
2. Worker waits until just before `this.age >= dv` would let C1 complete.
3. Organizer broadcasts C2 `objectClaim` with `sigV` and sponsor input.  
   Output 0 = `disputePayLock` (`phi = 100`), value `F`.
4. Worker can no longer use C1. After `l = 2016` blocks from C2 confirmation, anyone broadcasts D4 fallback:  
   output 0 = `lockW`, value `F`.

Result: worker still gets the full `F`, but waits up to `l` blocks instead of `dv`. If organizer times C2 just before C1 matures, delay is roughly 2016 blocks (~14 days). **Who loses what:** worker loses time value, not principal. **Severity:** medium. **Type:** real design limitation; the code comments explicitly say C2-C4 have no upper time limit.

---

## F3 — Token-bearing funding UTXO is permanently unspendable

**Contracts/functions:** every path checks `tx.inputs[0].tokenCategory == 0x`.

If the funding transaction creates output 0 to the Funded contract with a CashToken attached, then F1 accept and F2 cancel both fail at the input token check. No other state exists to recover it. The `F` satoshis are locked forever.

Transaction: funding tx pays the Funded contract script with `tokenCategory != 0x` and value `F`. Any subsequent F1/F2 spend fails.

**Who loses what:** organizer loses `F`; worker loses expected payment. **Severity:** medium if the builder/wallet can accidentally attach a token. **Type:** design limitation; the software creating the funding output must ensure it is token-free. Sending a token to the contract address as a separate UTXO burns that token, but does not affect the original pact UTXO.

---

## F4 — F2 cancel has no value floor

**Contract/function:** `GigPactFunded.cancel`.

F2 does not require `F >= dustSafe`. If `fundedValue` were below relay dust, e.g. `F = 500`, the organizer’s cancel transaction would create `output0 = lockV`, value `500`, which is likely nonstandard and rejected by relay policy. Under the stated project constraint `F >= 8000`, this is not reachable. **Severity:** low/info. **Type:** false alarm under stated parameters; the code comment already acknowledges it.

---

## F5 — Odd-satoshi rounding sends extra sat to organizer

**Contract/function:** `GigPactDispute.decideSplit`, `fallback` with `phi = 50`.

For `F = 8001`, `fA = 2000`, D3 gives worker `3000` and organizer `3001`. D4 `phi = 50` gives worker `4000` and organizer `4001`. This is deterministic integer division, not theft. **Severity:** info. **Type:** false alarm.

---

## Direct answers

### 7(a) If the organizer never does anything after the worker accepts, is the worker’s money safe and collectable?

Yes, assuming correct constructor parameters and the worker has a sponsor input for F1/A3.

Exact sequence:

1. Funded UTXO -> F1 `accept` with `sigW` and sponsor input. Output 0 = Accepted contract, value `F`.
2. Wait until block height `>= tEnd`.
3. Accepted UTXO -> A3 `claim` with `sigW`, sponsor input, `nLocktime >= tEnd`, non-final input sequence. Output 0 = Requested contract, value `F`.
4. Wait `dv = 432` confirmations after the A3 transaction.
5. Requested UTXO -> C1 `complete` with any sponsor input, `input0` sequence encoding relative lock `>= dv`. Output 0 = `lockW`, value `F`.

Worker gets `F`. If organizer never acts, no organizer signature is needed after F1.

### 7(b) Before the worker accepts, is the organizer’s money safe and recoverable?

Yes, before accept, via F2 `cancel`.

Exact sequence:

1. Funded UTXO -> F2 `cancel` with `sigV` and sponsor input. Output 0 = `lockV`, value `F`.

Organizer recovers `F`.

Caveat: if the worker’s F1 `accept` transaction confirms first, F2 is invalid. The organizer cannot then unilaterally recover the full fee; the state is Accepted. So “before accept” yes, but it is a race if the worker is monitoring and wants to front-run cancel with accept.

---

## Checked and found correct

- Signature gating: F1 worker, F2 organizer, A1 organizer, A2 worker, A3 worker, A4 organizer, C2/C3 organizer, C4 worker, D1-D3 arbiter, D5 organizer, D6 worker. C1 and D4 are intentionally unsigned.
- Output 0 is pinned for locking bytecode, value, and token category on every path. Extra outputs are only sponsor change and are token-zero checked.
- `this.activeInputIndex == 0` forces the contract UTXO to be input 0. Input count 2-3 and output counts per path are correctly bounded.
- Token category is checked on every input and every output in every path. No token can be attached to a spendable pact UTXO.
- CLTV/CSV lower bounds are used for `tEnd`, `tA4`, `dv`, and `l`; no path is usable early if parameters are correct.
- Dust checks in Funded accept and Dispute paths are sufficient under stated `fA = 2000`, `dustSafe = 1000`, `F >= 8000`.
- D1/D2/D3/D4 output values and counts are internally consistent.
- `phi` handling is correct at runtime: D4 branches on `phi == 100` vs `phi == 50`; no on-chain mixing if the builder points to the correct Dispute instance.
- No path permanently locks funds if keys are available, parameters are correct, and the funding UTXO is token-free. D4 provides a fallback.

---

## Questions I could not answer from the code alone

- Whether the external builder actually sets the correct next-state locking bytecodes, role payout locks, `phi`, `fA`, `tA4 = tEnd + G`, `dv`, `l`, and `dustSafe`.
- Whether the funding output is guaranteed token-free.
- Whether the app uses `SIGHASH_ALL` for sponsor inputs; the contracts pin the contract outputs, but sponsor change can be altered if a sponsor signs with a non-committing sighash.
- Whether event completion is verified off-chain. The contracts cannot verify that the worker performed.
- Whether the arbiter private key is truly lost in practice.
- Exact network relay/dust policy for the chosen `dustSafe = 1000`.
- I assumed standard CashScript 0.14 CLTV/CSV semantics for `tx.time` and `this.age`; I did not verify compiler output from the source alone.