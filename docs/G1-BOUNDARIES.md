# G1 security boundaries (recorded 2026-11-14, after cross-review)

Evidence level of G1 at the time of recording (14 November): source compiled with cashc 0.14.0 on two machines (hashes match); no path executed yet. Later evidence is recorded in the sections below (R-VM, regtest) and in docs/evidence (mainnet, M1 to M7).

- G1-01 (fixed in source): `Funded.cancel` (F2) no longer requires `F >= dustSafe`. At consensus-script level the contract no longer blocks a refund of a sub-DUST_SAFE UTXO. This is not a recovery guarantee: the refund still needs a sponsor input for the fee and network relay policy must accept the output (measured in G7). Tests needed in G2: F2 below/equal DUST_SAFE, amounts different from fundedValue, network dust-policy limits.
- G1-02 (boundary): the contracts verify the role signature with `checkSig` but do NOT restrict the signature hash type on-chain. Sighash 0x61 is a transaction-builder (G6) policy, not a contract guarantee. It must not be presented as an on-chain guarantee.
- G1-03 (boundary): constructor parameters (acceptedLock, requestedLock, disputePayLock, disputeRefundLock, lockV/W/A, tA4, fA, phi, ...) are not cross-checked inside the contracts. Their consistency is enforced by the transaction library when it builds the chain (I12). I12 is NOT yet verified: no transaction library or test exists yet. Source compilation does not close this dependency.
- G1-04 (boundary): K17 declared-funding-outpoint rule is app/tx-library layer, not coded in the contracts. R-VM tests alone cannot verify K17 (the contract does not see it); it needs the transaction library plus job-identity tests, including fake, duplicate and third-party funding.
- G1-05 (boundary): DUST_SAFE = 1000 sat is an unmeasured assumption. No recovery guarantee for arbitrary standard outputs before G7 measurement.
- PUSD mode is not implemented. BCH mode only.

## G2 part 2 status (library layer; evidence level: R-VM dry-run with synthetic outpoints only)

- G1-03 (I12): enforced in `src/chain.mjs` (`buildChain`, `verifyChain`, `assertChain`) and exercised in `test/lib.test.mjs`. Not regtest, wallet or mainnet evidence.
- G1-04 (K17): enforced in `src/k17.mjs` and `planSpend` (declared outpoint, exact value F, job bound to the exact chain). Job persistence/UI storage does not exist yet.
- Not proven here: BIP68 UTXO aging, locktime finality against tip/MTP, mempool dust/relay (DUST_SAFE still unmeasured, G1-05), conflicting spends, wallet signing. These remain G3+.

### G2 part 2: review history and known residual limits (library layer, R-VM dry-run level)

Review: three independent clean-context Claude reviews (no ChatGPT review for this part; ChatGPT was unavailable). Round 1 REJECT, round 2 CONDITIONAL PASS, round 3 CONDITIONAL PASS; every BLOCKER, MAJOR and the cheap MINOR items were fixed and mutation-tested. These are not a substitute for regtest (G3) or an external audit.

Known residual limits, accepted for now:
- `buildTx`/`inspectTx` trust a plan object; they do not authenticate that it came from `planSpend` (a hand-built plan is the caller's responsibility).
- Typed arrays inside a plan (locks) cannot be frozen; each is a private copy, and the plain-data fields are frozen.
- A `job` record is not snapshotted against hostile getters (the plan contains no job values).
- `inspectTx` does not enforce the fee-rate cap; `buildTx` does. The cap is `size*2 + 2 sat` (a 2-sat allowance), so the real rate at 2 sat/byte is about 2.002.
- Change floor is `max(546, 3*(157+len))` sat per the SDK rule (P2PKH 546, P2SH32 576); real relay policy is measured at G7. DUST_SAFE (1000) is still unmeasured.

## G3 regtest status (evidence level: regtest, BCHN 29.2.0, local; no wallet, no mainnet)
- G3-a (`test/regtest/g3a.test.mjs`, results-regtest.json): funding -> F1 -> A3 -> C1 accepted by the node and mined. A3 at tip=tEnd-1 rejected (`bad-txns-nonfinal`), at tEnd accepted. C1 at 431 confirmations rejected (`non-BIP68-final`), at 432 accepted. Sponsor nSequence 0xfffffffe seen on the wire.
- G3-b (`test/regtest/g3b.test.mjs`, results-regtest-g3b.json): wrong signer, wrong output lock, wrong amount (F1), wrong signer (F2), final nSequence on A3 input, nSequence 431 on C1 input are all rejected by the node with the asserted reason; unmodified controls accepted; replay after confirmation rejected.
- Node dust policy measured: P2PKH output accepted from 546, P2SH32 from 576 (545 / 575 rejected as dust); matches `changeFloor`. DUST_SAFE=1000 sits above both. Relay fee: ~0.5 sat/B rejected (`min relay fee not met`), >1 sat/B accepted.

### G3-c (regtest, BCHN 29.2.0): dispute paths — `test/regtest/g3c.test.mjs`, results-regtest-g3c.json
- C2 (Requested -> Dispute100) and A4 (Accepted -> Dispute50) accepted; A4 at tip=tA4-1 rejected (`bad-txns-nonfinal`), at tA4 accepted (tA4 = tEnd+G = 1308).
- D1 (W gets F-fA, A gets fA), D2 (V gets F-fA, A gets fA), D3 (49000/49000/fA), D5 (W gets F), D6 (V gets F): accepted with the exact payouts read back from the node. D4 on Dispute100: all to W; on Dispute50: F/2 each to W and V. D4 at 2015 confirmations rejected (`non-BIP68-final`), at 2016 accepted (both instances).
- Negatives rejected with asserted node reason: D1 signed by W; D1 arbitrator fee fA-1; D3 unequal split; D5 signed by W; D6 signed by V; A4 signed by W.
- Still not measured: token-carrying inputs, multi-sponsor txs, odd-net D3 rounding on the node, wallet signing, mainnet. 

### G3 review (clean Claude review, not an independent PASS): CONDITIONAL PASS, no blockers
Findings applied: g3a now asserts the rejection reasons (`bad-txns-nonfinal`, `non-BIP68-final`) and reads A3/C1 nSequence from the node; g3b/g3c pin the failing script step (CHECK(MULTI)SIG / OP_EQUALVERIFY / OP_NUMEQUALVERIFY), dust and replay reasons; the regtest node helper refuses a foreign node on its port, requires a fresh regtest chain and cleans up on SIGINT/SIGTERM.
Classification caveat: the two script-level timing negatives (A3 input with final nSequence; C1 input nSequence 431) were rejected as `non-mandatory-script-verify-flag (Locktime requirement not satisfied)`, i.e. mempool-policy class. No block containing a rejected tx was submitted, so these are not shown to be consensus-invalid. `bad-txns-nonfinal` and `non-BIP68-final` are finality checks at next-block height.
Not measured (complete list): block-level validation of any tx (everything went through `sendrawtransaction`); mainnet parameters (regtest uses tEnd=300 and has all upgrades active from genesis; mainnet activation of the VM features the contracts rely on is not covered); the exact relay-fee boundary (only ~0.5 sat/B rejected and >1 sat/B accepted) and the library fee bounds on the node; D5/D6 on Dispute(50); happy-side A1, A2, C3, C4 and F2 beyond a control; C2 negatives and A3/C1 wrong-signer negatives; token-carrying inputs; multi-sponsor txs; odd-net D3 rounding; wallet signing; mainnet.
Known test hygiene: each regtest file depends on its own setup test and on `--test-concurrency=1`; the results-regtest*.json files are rewritten (new txids) on every run.

### Gemini review (read-only, different model, 15 Nov): CONDITIONAL PASS, no blocker/major
- Two MINOR items, both already covered or UI-level: (1) sponsor change below the floor goes into the fee — bounded by the `FeeTooHigh` cap (size*2+2 sat), so the loss cannot exceed that; a UI should still warn near the drop zone. (2) `tEnd` is not compared with the live chain tip (the library has no tip at job creation; `planSpend` guards CLTV with the tip at spend time) — the job-creation UI must reject a `tEnd` in the past or too near.
- Not accepted: the statement that all 16 paths ran on regtest is wrong (see "Not measured (complete list)" above). The mutation SIGHASH_61 -> 0x41 is NOT undetected: with it, the plan/dry-run tests fail (F1..D1 and others), checked by running `npm test` on a mutated copy. The claimed D3 rounding remnant does not exist (V gets F-fA-w, no satoshi unallocated); odd-net D3 on the node remains unmeasured.
- Gemini read the text only and ran nothing: regtest outcomes are not independently reproduced by it.

## G4-a WizardConnect module (16 Nov 2026) — `src/wizard.mjs`
(The text below is the state at G4-a. Later the same day Paytaca signed F1, A1, F2, A3, A2, C3 and C4 on mainnet: see docs/evidence/M1 to M6.)
Evidence level: R-VM + regtest with a SOFTWARE wallet (`test/wallet-sim.mjs`). No real wallet (Paytaca, Selene) has signed anything with this module yet; no mainnet.
- Design (Yol B): the contract input is signed in the browser with the role key (V/W/A) and arrives in the request with its complete unlocking bytecode; the only input the wallet signs is the sponsor P2PKH input (empty script in the request). `inputPaths` is sparse: `[[inputIndex, pathName, addressIndex]]` for sponsor inputs only. Request shape follows `@wizardconnect/dapp` 0.2.7 / `@wizardconnect/core` 0.2.10 (pinned): `transaction: { transaction: <hex>, sourceOutputs: [relay JSON], userPrompt? }`, bytes as hex, bigint as `<bigint: Nn>`.
- Why it works: the 0x61 (ALL|FORKID|UTXOS) preimage commits to outpoints, sequences, outputs and all source outputs but not to unlocking scripts, so the wallet filling the sponsor script afterwards cannot invalidate the role signature. The fee is fitted against a 100-byte dummy sponsor script (fixed-width Schnorr), then the dummy is blanked; no throwaway key is used.
- `verifySigned` does not trust the wallet: the answer must equal our request byte for byte outside the sponsor unlocking scripts; each sponsor script must be `<65-byte sig, hash type 0x61> <33-byte key>` with a key that hashes to the sponsor address (optionally pinned to the named path/index); every input is script-verified offline in the libauth VM; size and fee must match the plan. `findSponsorPath` refuses, before sending, a sponsor address the connected wallet does not control.
- Tests: `test/wizard.test.mjs` (41, R-VM): all 16 paths (D4/D5/D6 on both Dispute instances) through request -> JSON -> software wallet -> verify; two sponsors on different paths; 16 wallet-misbehaviour cases (refusal, unsigned, 0x41, 0xc1, wrong key, changed amount / extra output / redirected output / locktime / version / sequence / contract script / extra input, flipped signature, malformed script, pinned-path mismatch) each refused with its own error code. Mutation check (done by hand, not committed): removing the VM check, the byte-for-byte comparison, the hash-type check or the key-vs-address check each makes the matching tests fail; removing the final size/fee comparison fails nothing (redundant with the byte comparison plus `inspectTx`; kept as defence in depth).
- `test/regtest/g4a.test.mjs` (4, BCHN 29.2.0): F1 and then A1 with a wallet-signed sponsor input are accepted and mined; the node's txid equals the txid computed by `verifySigned`; the F1 change output at `change/0` is reused as the next sponsor.
- Library change: `toBuilder` gained an optional `sponsorUnlock` hook (3 lines in `spend.mjs`); default behaviour is unchanged (all earlier tests still pass: 205 R-VM, 20 regtest).
- NOT shown: any real wallet's behaviour (does it sign only inputs listed in `inputPaths`; does it accept an empty sponsor script; does it show the outputs; Selene's path data), the relay/Nostr transport, chunking of large requests, session persistence, the browser UI, mainnet. We omit the optional `contract` info in `sourceOutputs`; whether any wallet needs it is unknown.
