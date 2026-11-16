# M6 - the worker waives at the claim stage on mainnet (C4: the worker gives the money back after claiming)

Evidence level: **real wallet (Paytaca via WizardConnect) + mainnet**. Paths tested: **A3** (the worker claims after the event end, third mainnet run) and **C4** (Requested -> organizer's refund address, signed by the worker only, no timelock).
Date: 2026-11-16 (Istanbul, about 19:40-20:20). Network: Bitcoin Cash mainnet.

## What was done
- A test pact "Test 6 C4" (10,000 sat, event end = block 977,643) was created in the app. The worker payout address was one of the tester's own Paytaca addresses and the organizer's refund address was a different one (`qq6emf23fmtapah3deeghj33e7jd3c2esuj566vffm`), so a refund and a payout can be told apart on the chain. The organizer used a second browser (private window). The pact was funded with exactly 10,000 sat (one payment) and accepted (F1) with the real wallet.
  - Funding outpoint: `134ebd8ee61082ff3c11bb4f1530a5787fa82783eeaf8a745b137fe874633fba:0`
  - F1 accept transaction: `c00eca181df08e0d5ce6c42f4660ef63fbd416cf4c32216829afdb8d8e44c284`
- After the chain passed block 977,643 the worker pressed "Claim the pay" (A3).
  - **A3 claim transaction:** `66338fc791b14f0edb468e6ddf53ce1dbc18849e00f559d2d1d372f4551297e3`
- With the money at the claim stage the worker pressed "Waive: give the money back". Paytaca signed the sponsor input over WizardConnect, the worker role key signed the pact input in the browser, the app verified the answer and broadcast.
  - **C4 waive transaction:** `79a6782d58ff7c324bcaac18e16309a2cf9d5db63933637abc25e66703ef380c`
- The page then showed the pact as "Settled (C4)" and the money as sent to the refund address.

## Block-explorer check (3xpl.com, 2026-11-16)
**A3 claim `66338fc7...297e3`**
- Confirmed in block **977,647** (17:02 UTC). Locktime **977,643** (the event end block). Size 870 bytes, fee **872 sat**, version 2.
- Input 0: the pact's Accepted address (starts `p09ylj75mpghlgzf...`), 10,000 sat. Output 0: the claim-stage address (starts `p0qd2d6sy40mv8r6...`), **10,000 sat**.
- Input 1 (wallet sponsor) 7,646 sat, output 1 (change) 6,774 sat. The difference is the fee, paid by the sponsor input.

**C4 waive `79a6782d...ef380c`**
- Confirmed in block **977,648** (17:12 UTC, 3 confirmations at the time of the check). Locktime **0** (C4 has no time condition), size 807 bytes, fee **809 sat**, version 2.
- Input 0: the claim-stage address (`p0qd2d6sy40mv8r6...`), 10,000 sat. Output 0: `qq6emf23fmtapah3deeghj33e7jd3c2esuj566vffm` (the organizer's refund address, not the worker's payout address), **10,000 sat**: the whole pact amount goes back.
- Input 1 (sponsor) 6,774 sat, output 1 (change) 5,965 sat. The fee, 809 sat, is not taken from the pact money.
- The C4 input is exactly the A3 claim-stage output, so the pact moved Accepted -> Requested -> refund without the money ever leaving the contract rules.

## What this shows
- After claiming, the worker can still give the money back with their own role key only, and the network accepts it. The money goes to the organizer's refund address, a different address from the worker's payout address, and the whole amount arrives.
- With M1-M5, F1, A1, F2, A3, A2, C3 and C4 have now run on mainnet with a real wallet.

## What this does NOT show
- The same wallet owned both roles' addresses and fee input, so this does not show two separate people. The two roles did run in two separate browsers, so each signature came from a different role key.
- C1 (the worker collects after 432 blocks) is planned for 19 Nov and will have its own evidence. C2, A4 and D1-D6 have not run on mainnet with a real wallet.
