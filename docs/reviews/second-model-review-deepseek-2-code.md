<!--
Second review round: contracts AND transaction code. Raw output, kept unedited below the line.
Reviewer: DeepSeek, web chat, file upload (the model version and the reasoning mode were not recorded). Same reviewer as second-model-review-deepseek.md, new prompt.
Date: 19 November 2026. Input: docs/reviews/review-prompt-2.md (instructions) plus these files, each starting with a line "=== path ===":
contracts/*.cash, src/chain.mjs, src/spend.mjs, src/wizard.mjs, src/errors.mjs, web/pact.js, web/config.js.
The reviewer did NOT get src/k17.mjs, the browser UI (web/app.js, web/accept.js and the others), the chain-provider failover or the key storage, and says so in its answers.
This is a read-only review by an AI model from a different vendor than the one that wrote the code. It is NOT an independent audit.
Our own check of each finding, against the code and tests, is in docs/SECURITY-LIMITS.md.
-->

Assumptions I made while reviewing: `k17.mjs`/`assertF1Funding` was not provided, so I assume it really checks the F1 funding outpoint/value; CashScript `SighashType.SIGHASH_ALL | SIGHASH_UTXOS` really serializes as `0x61`; libauth VM verification is script-correct and node consensus enforces BIP68/CLTV. I did not review the UI, localStorage handling, wallet connector, or chain-provider failover because they are not in the attachment.

## Findings

| ID | File / function | One-line summary | Severity | Type | Confidence |
|---|---|---|---|---|---|
| F-1 | `web/pact.js` `encodePact`/`decodePact`/`termsOf`; `src/chain.mjs` `normalize`/`buildChain` | Pact links are unauthenticated and do not bind role keys to payout locks; an in-transit attacker can substitute worker key/address and steal or lock funds. | High | Real bug | High |
| F-2 | `src/spend.mjs` `planSpend`; contracts `GigPactAccepted/Requested/Dispute` | For all non-F1 spends, the library does not check that the contract UTXO value/outpoint is the agreed pact coin; contracts after Funded only require `F >= dust`. A malicious chain provider can hide/show alternate UTXOs and confuse state. | Medium | Real bug/limitation | High |
| F-3 | `src/chain.mjs` `normalize`; `web/pact.js` `decodePact`/`checkNumbers`; `web/config.js` `MIN_LEAD_BLOCKS` | Event end in the past is accepted by the library/link; `MIN_LEAD_BLOCKS` is defined but not used in provided code. | Medium | Limitation | High |
| F-4 | `web/pact.js` `encodePact`/`decodePact`/`termsOf`; `web/config.js` constants | Pact links and term fingerprints do not commit to `FA`, `G`, `dv`, `l`, `dust`, or arbiter key. A config change without bumping `v` silently changes contract addresses. | Medium | Limitation | High |
| F-5 | `web/pact.js` `parseAddress` | Comment says token-aware addresses are refused, but code only checks `d.type === 'p2pkh'` and not any token-support flag. | Low | False alarm / possible mismatch | Medium |
| F-6 | `src/spend.mjs` `planSpend` | Plan is not deeply immutable: `Uint8Array` lock fields remain mutable through the returned frozen plan. | Low | Limitation | High |
| F-7 | `src/spend.mjs` `toBuilder` | Local signing uses one `keys.S` for every sponsor input; two sponsors with different addresses cannot be locally signed. Wizard path is per-sponsor. | Info | Limitation | High |
| F-8 | `src/spend.mjs` `buildTx` error text | Fee-too-high message says “change below MIN_OUTPUT 546” even when `changeFloor(changeLock)` is 576 for P2SH32. | Info | Misleading message | High |

## Finding details

### F-1 — Unauthenticated pact link and no key/payout binding

**Attack steps**

1. Worker creates a normal link. It is just base64url JSON containing `name`, `F`, `tEnd`, `pkW`, `lockW` and later `pkV`, `lockV`.
2. Attacker who can modify the link in transit decodes it, changes `pkW` and `lockW` to the attacker’s own compressed pubkey and P2PKH address, re-encodes it, and forwards it.
3. Organizer opens the modified link. `decodePact` only checks structure: `v === 1`, network, numeric shape, 33-byte pubkey hex, and 25-byte P2PKH lock hex. It does **not** check a signature, MAC, or that `lockW` belongs to `pkW`.
4. Organizer enters a refund address and pays the displayed funding address. The contract now embeds attacker `pkW`/`lockW`.
5. Attacker signs F1 accept with the attacker’s `pkW`, waits until `tx.time >= tEnd` if needed, signs A3 claim, then after `dv` broadcasts C1 complete and receives full `F`.

If the attacker changes only `lockW` and leaves `pkW` as the worker’s key, the worker cannot spend the funded contract using the original chain, and the organizer must notice and F2-cancel; otherwise funds are stuck until cancel.

**Who loses what**

- With `pkW` + `lockW` substitution: organizer loses full `F` to attacker.
- With only `lockW` substitution: worker/organizer suffer lock-up/DoS; organizer can recover only if they cancel before accept.
- Also, a malicious worker can intentionally put a `lockW` unrelated to `pkW`; that is less a theft from organizer than a confusing/malformed pact.

**Evidence**

`web/pact.js` `encodePact`/`decodePact` only do structural validation. `termsOf` is only a local fingerprint; it does not authenticate a received link. `src/chain.mjs` `normalize` checks that `pk` is a valid public key and `lock` is 1..100 bytes, but never checks `lockW === P2PKH(hash160(pkW))` or `lockV` belongs to `pkV`.

### F-2 — Non-F1 spends do not bind UTXO value/outpoint to the pact

**Attack steps**

1. Real pact has agreed `F = 10000`, but attacker/malicious provider creates or points to a different UTXO at the same contract lock, e.g. 1000 sat sent to the Accepted address.
2. App calls `planSpend({ chain, path: 'A3', utxo: fakeUtxo, ... })`.
3. `planSpend` checks only that `fakeUtxo.lockingBytecode` equals the Accepted contract lock. It sets `F = utxo.satoshis` and builds A3 for 1000 sat.
4. Worker signs A3 claim of the fake 1000-sat UTXO; real 10000-sat UTXO remains in Accepted. Worker/app may believe the claim was done, stop watching, and miss the real claim window.
5. A malicious provider can hide the real UTXO until `tA4 = tEnd + G`, then a malicious organizer opens A4 to the 50/50 dispute. Worker has lost the chance to claim full `F` before A4; this is worse than known item (2), which assumes the worker sees and can claim the real UTXO.

The same missing check exists for F2, A1/A2/A4, C1-C4, and all D paths. Only F1 calls `assertF1Funding(job, utxo, chain)`; `k17.mjs` was not provided. The contracts in states Accepted/Requested/Dispute only require `F >= dustSafe`; they cannot know the agreed `F`.

**Who loses what**

- Worker can be tricked into claiming/waiving a wrong UTXO, or can miss the real claim and lose up to half via A4.
- Organizer can be tricked into paying/advancing a wrong UTXO; usually fee/state confusion, not direct theft of the real `F`.
- Direct theft of the real `F` still needs a role key or the known A4/C2 timing attacks.

**Evidence**

`src/spend.mjs` `planSpend`:
```js
const F = utxo.satoshis;
const outs = P.outs(L, F, p, phi)...
```
There is no `need(utxo.satoshis === p.F)` or prior-state outpoint check for any path except the missing F1 job check. `GigPactAccepted`/`Requested`/`Dispute` only enforce `F >= dustSafe`.

### F-3 — Past event end and no minimum lead are accepted by the library

**Attack steps**

1. Worker creates a link with `tEnd = 1` or any height already passed.
2. `decodePact` accepts it: `o.tEnd > 0 && o.tEnd < 500_000_000`.
3. `checkNumbers`/`chainFor` call `normalize`; `normalize` checks `tEnd + G < 500_000_000` but not `tEnd >= currentHeight + MIN_LEAD_BLOCKS`.
4. Organizer funds. Worker accepts, immediately claims with A3 (`tx.time >= tEnd`), then collects after `dv`.

This is not a cryptographic theft, but it lets a worker present a “past gig” pact that can be claimed immediately. `web/config.js` defines `MIN_LEAD_BLOCKS = 6` but it is not used in the shown chain/link code.

**Who loses what**

Organizer can pay for an already-finished event and has no time to cancel if they accept the link at face value. The UI may check this, but the library/link does not.

**Evidence**

`src/chain.mjs` `normalize` validates only positive bigints and upper bounds. `web/pact.js` `decodePact` validates only `tEnd > 0 && tEnd < 500_000_000`.

### F-4 — Config constants are not committed by link/version/fingerprint

**Attack/upgrade steps**

1. Current app builds chain with `FA = 2000n`, default `G = 1008n`, `dv = 432n`, `l = 2016n`, `dust = 1000n`.
2. A future app changes one of those constants but still uses `v: 1`.
3. Old link decodes because `decodePact` only checks `o.v === 1` and `o.n === NET`.
4. `termsOf` does not include `FA`, `G`, `dv`, `l`, `dust`, or `ARBITER_PK`.
5. The new app silently builds a different chain. If organizer already paid the old address, new app/worker may not reconstruct it; funds can be stuck until the old version/app is used.

**Who loses what**

Funds can be locked or state can diverge across app versions. Not an immediate attacker-controlled theft unless an attacker can induce a config mismatch, but it is a real upgrade/versioning gap.

**Evidence**

`web/config.js` exports `FA`, `ARBITER_PK`, defaults. `web/pact.js` `encodePact` writes only `v,n,name,F,tEnd,pkW,lockW` plus optional V data. `termsOf` does not hash config constants. `chainFor` uses `FA` but the link does not.

### F-5 — Token-aware address comment vs code

`parseAddress` comment says token-aware addresses are refused on purpose. The code checks `d.type === 'p2pkh'` and does not visibly check a token-support field. If libauth reports token-aware P2PKH as `type: 'p2pkh'`, this comment is false. Impact is likely low because the locking bytecode of a token-aware P2PKH address is still P2PKH, but the promised refusal is not visible in the code.

### F-6 — Plan immutability is shallow

`planSpend` freezes plain objects, but `Uint8Array` lock fields cannot be frozen. A caller holding the returned plan can mutate `plan.outs[i].lock`, `plan.input0.lockingBytecode`, or sponsor `lockingBytecode` bytes. That can make later building/inspection use different locks than intended. This requires code in the same origin/app to do it; it is not reachable from a wallet response.

### F-7 — Local multi-sponsor signing uses one key

`toBuilder` local path does:
```js
new SignatureTemplate(keys.S, SIGHASH_61).unlockP2PKH()
```
for every sponsor. If two sponsor inputs have different addresses, local dry-run/signing cannot sign both. Wizard path uses `sponsorUnlock` per sponsor and is fine. Info only.

### F-8 — Misleading fee message

`buildTx` fee-too-high message uses `MIN_OUTPUT` (546) even if `changeFloor(changeLock)` is 576 for P2SH32. Minor.

## Section C — Cross-layer properties contracts do NOT enforce

| Property | Contract enforcement | JavaScript enforcement / gap |
|---|---|---|
| Next-state locking bytecode is the correct contract for the same params | No; contracts only require `output[0].lockingBytecode == embedded bytes` | `src/chain.mjs` `buildChain`/`assertChain`; `src/spend.mjs` `planSpend` checks UTXO lock. |
| Role pubkeys in next state match pact | No | `src/chain.mjs` `buildChain`/`assertChain` uses `p.pk`; no contract check. |
| Payout locks V/W/A in next state match pact | No | `buildChain`/`assertChain`; `web/pact.js` `decodePact` only checks P2PKH shape, not key↔lock binding. |
| `tEnd`, `tA4`, `G`, `dv`, `l`, `fA`, `dust`, `fundedValue` consistency across states | No | `normalize` computes `tA4`; `buildChain`/`assertChain`; config constants not in link/terms. |
| UTXO value equals agreed `F` in Accepted/Requested/Dispute | No; only `F >= dustSafe` | **Not found for non-F1.** `planSpend` uses `utxo.satoshis` as `F`. F1 relies on missing `assertF1Funding`. |
| UTXO outpoint is the exact one created by previous state/funding | No | **Not found** in `planSpend` except missing F1 job check. |
| UTXO has no CashToken | Spend input `tokenCategory == 0x` checked; funding output with token known unspendable | `planSpend` checks `utxo.token` and sponsor tokens. |
| Sponsor change lock/value belongs to user and accounting is correct | No; contracts only check change `tokenCategory == 0x` | `inspectTx`, `buildTx`, `verifySigned` pin change lock/value/fee. |
| Sighash type is `0x61` | No; `checkSig` accepts any valid sighash flag in the signature | `SIGHASH_61` in `keyTemplate`/`toBuilder`; `verifySigned` `parseP2pkhUnlock` checks sponsor sighash byte. |
| Transaction version >= 2 for BIP68 | No | `inspectTx` checks `tx.version >= 2`; `verifySigned` pins expected tx. |
| CLTV/CSV lower bounds | Yes via `tx.time`/`this.age` and node consensus | `planSpend` sets locktime/sequence and checks `tipHeight`/`confirmations` in non-dry-run. |
| No extra outputs beyond contract outputs + one change | Contracts cap output count, but allow change lock/value arbitrary | `inspectTx` output count, lock, value, token checks. |
| Contract outputs sum to contract input | Contracts check specified outputs but not change | `planSpend` conservation; `inspectTx` `contractOut === input0`. |
| Role key corresponds to payout address | No | `decodePact` checks P2PKH shape only; **no binding**. |
| Pact link authenticity | No | **Not found**; no signature/MAC in `web/pact.js`. |
| Network/prefix | No | `parseAddress`, `decodePact` check `NET`/`PREFIX`. |
| Event end is in the future / minimum lead | No | **Not found**; `MIN_LEAD_BLOCKS` unused in shown code. |
| `F` upper bound / CashScript int range | No | `normalize` only checks positive bigint; no max. |
| Chain data truth/confirmations | No | `planSpend` trusts caller `ctx`; provider not in files. |
| Arbiter private key is not retained | No | `web/config.js` only stores pubkey. |
| UI does not offer C2/A4/dispute | Contracts allow these paths | UI not in files. |

## Section D — Direct questions

### (a) If the organizer never does anything after the worker accepted, can the worker always collect full F?

Yes, if the worker’s app/wallet can see the real Accepted UTXO and pay fees.

Exact sequence:

1. `F1 accept` — worker W signs. Input 0 = Funded UTXO value `F`; sponsor input(s) pay fee; output 0 = Accepted lock, value `F`; optional change to sponsor.
2. Wait until chain height `>= tEnd`.
3. `A3 claim` — worker W signs. Input 0 = Accepted UTXO value `F`; sponsor pays fee; `nLockTime = tEnd`; sequence non-final; output 0 = Requested lock, value `F`.
4. Wait until the Requested UTXO has at least `dv = 432` confirmations.
5. `C1 complete` — no signature. Input 0 = Requested UTXO; input 0 sequence = 432; sponsor pays fee; output 0 = `lockW`, value `F`.

The worker’s software must build the exact chain, use W’s key for F1/A3, set A3 locktime correctly, wait for 432 confirmations, and the worker’s wallet must sign sponsor inputs with `0x61` for F1/A3/C1. If the organizer does nothing and no malicious chain provider hides the UTXO, the worker gets full `F`.

### (b) Before the worker accepts, can the organizer always get full F back?

Yes, subject to relay/dust policy.

Exact sequence:

1. State is Funded.
2. Organizer V signs `F2 cancel`. Input 0 = Funded UTXO value `F`; sponsor pays fee; output 0 = `lockV`, value `F`; optional change.
3. Broadcast.

The contract F2 requires only `sigV`, output 0 = `lockV` value `F`, no value floor. If `F` is below relay dust or the refund output is non-standard, relay may refuse; this is the known sub-dust cancel limitation.

### (c) Can any single party, with only its own role key, take the whole F outside known limits?

- Worker W: yes, after the organizer has funded and the worker has accepted, W can wait until `tEnd`, sign A3 claim, wait `dv`, and broadcast C1 to get full `F`. This is the intended worker path. W can also get full `F` via the `d100` fallback after a false objection, which is a known dispute/fallback behavior.
- Organizer V: yes, before worker accepts, V can F2-cancel and get full `F`. After Accepted, V cannot take full `F` alone: A1 pays worker, A4 moves to 50/50 dispute, C2 object moves to d100 and its fallback pays worker full, D5 pays worker, D6 needs W.
- No other single role key can take the whole `F` outside the intended F2/A3+C1 and known dispute/fallback timing cases.

### (d) Can a sponsor, miner, or relay node change the outcome?

No direct change.

- Sponsor signs only its sponsor input(s) with `SIGHASH_61`. That commits to all outputs, sequences, and source outputs. It cannot alter contract outputs without invalidating the role signature and its own signature. It can refuse to sign or double-spend its sponsor UTXO before broadcast, causing DoS.
- Miner/relay can delay/censor and thereby trigger known timing issues (A4 after `tA4`, C2 before C1, fallback delay). They cannot forge role signatures or alter a signed transaction.
- A malicious wallet answering a signing request is checked by `verifySigned`: changed outputs/sequences/locktime/extra inputs/outputs, wrong sponsor sighash, wrong sponsor key, or changed contract script are rejected.

## Section E — Minimal reproductions for medium+ findings

### F-1

```js
const original = decodePact(workerLink);
const evil = { ...original, pkW: attackerPkW, lockW: lockOfPk(attackerPkW) };
const evilLink = encodePact(evil);
decodePact(evilLink); // succeeds; no signature/MAC check
// organizer funds chainFor(evil); attacker can F1 accept with attackerPkW
```

### F-2

```js
const chain = buildChain({ pk:{V,W,A}, lock:{V,W,A}, F: 10000n, fA: 2000n, tEnd: 1000n }, { provider });
const fake = { txid: '11'.repeat(32), vout: 0, satoshis: 1000n, lockingBytecode: chain.locks.accepted };
planSpend({ chain, path: 'A3', utxo: fake, sponsors: [enoughSponsor], ctx: { tipHeight: 1000 } });
// succeeds and builds a claim of 1000 sat; no check utxo.satoshis === 10000n
```

### F-3

```js
const p = decodePact(encodePact({ name: 'x', F: 10000n, tEnd: 1, pkW, lockW }));
const chain = chainFor(p, provider); // succeeds
planSpend({ chain, path: 'A3', utxo: fundedUtxo, sponsors, ctx: { tipHeight: 1 } });
// succeeds if A3 UTXO exists; tEnd=1 is already past
```

### F-4

```js
// Keep link unchanged, change web/config.js FA from 2000n to 3000n.
const oldTerms = termsOf(decoded, true);
const newTerms = termsOf(decoded, true); // identical
chainFor(decoded, provider).addresses.funded; // different from old app
// decodePact still accepts v:1; termsOf does not detect the config change
```

## What I checked and found correct

- `verifySigned` is strong against a wallet returning a different transaction. It blanks sponsor unlocking scripts, re-encodes, and requires byte equality with the expected unsigned transaction. Changed outputs, changed sequences, changed locktime, changed contract unlocking script, duplicated inputs, extra inputs, and extra outputs fail.
- Sponsor unlocking scripts are required to be exactly 100-byte P2PKH `<65-byte sig+0x61> <33-byte pubkey>`, and the pubkey hash must match the sponsor lock.
- The VM verifies all inputs offline against expected source outputs. Accounting is rechecked by `inspectTx`: contract outputs, change lock/value, fee, size, version, locktime, sequences.
- `assertChain` rebuilds from normalized parameters and compares addresses, locks, contract addresses, and extra keys. This is a good I12 enforcement point.
- `planSpend` rejects token-bearing contract/sponsor UTXOs, rejects sponsor outpoints at contract locks, rejects duplicate outpoints, enforces 1..2 sponsors, and checks the contract UTXO lock against the fresh chain.
- Fee/amount arithmetic is mostly `bigint`; fee rate is a bounded number; the fee cap/slack is explicit. I did not find a rounding or integer mix-up in the shown fee fitter beyond the P2SH32 message issue.
- `planSpend` sets CLTV locktime and CSV sequence correctly, and non-dry-run checks `tipHeight`/`confirmations`. A too-early transaction is rejected by node consensus even if `dryRun: true` is misused.
- No direct sponsor/miner/relay transaction alteration is possible with `SIGHASH_61` signatures; only delay/censorship/DoS.

## Questions I could not answer from the code alone

- `src/k17.mjs` / `assertF1Funding` was not provided. Does it check the exact funding outpoint, value, and chain? If not, F1 value is still checked by the contract, but provenance is not.
- The UI/state machine was not provided. Does it enforce `MIN_LEAD_BLOCKS`, `F` upper bounds, token-aware address refusal, and that the displayed pact link was authenticated out-of-band?
- The chain-provider failover was not provided. Does the app cross-check UTXOs/height/confirmations across providers, or can one malicious provider hide/fake/replay?
- WizardConnect library behavior and the real `SighashType` enum were not provided. I assumed `SIGHASH_61` really is `0x61`; if not, all signing is broken.
- localStorage key handling was not provided. If another tab or XSS can read/replace role keys, all role-key protections are void.