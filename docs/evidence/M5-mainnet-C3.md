# M5 - the organizer pays at the claim stage on mainnet (C3: the organizer releases the money to the worker)

Evidence level: **real wallet (Paytaca via WizardConnect) + mainnet**. Paths tested: **A3** (the worker claims after the event end, second mainnet run) and **C3** (Requested -> worker payout address, signed by the organizer only, no timelock).
Date: 2026-11-16 (Istanbul, about 19:30-20:05). Network: Bitcoin Cash mainnet.

## What was done
- A test pact "Test 5 C3" (10,000 sat, event end = block 977,641, worker payout address and organizer refund address = the tester's own Paytaca addresses) was created in the app. The organizer opened the request link in a second browser (a private window) and entered the refund address. The pact was funded with exactly 10,000 sat (one payment) and accepted (F1) with the real wallet.
  - Funding outpoint: `88a2b2b950ef6ed90a5b08fb33ac063ce2802b3953c9cb2a7d30c4c3480fe346:0`
  - F1 accept transaction: `a622eaf9f54931b2ddeafc673675fa8fa1b7b65759fc8757001114277a68f51b`
- After the chain passed block 977,641 the worker pressed "Claim the pay" (A3).
  - **A3 claim transaction:** `22bea50d40ae639ab5b3c49ef475ee7f1abd3e66cd6bba4915b9099d2b4f7e70`
- In the organizer's browser the pact then showed "Claimed: waiting period" with the button "Pay the worker now". The organizer pressed it before the 432-block waiting period had passed. Paytaca signed the sponsor input over WizardConnect, the organizer role key signed the pact input in the browser, the app verified the answer and broadcast.
  - **C3 payout transaction:** `9cf26120e411932e019752a6d8e59b22a72dc81341505ff2be0d6923fa2f8690`
- The page then showed the pact as "Settled (C3)".

## Block-explorer check (3xpl.com, 2026-11-16)
**A3 claim `22bea50d...f7e70`**
- Confirmed in block **977,646** (17:00 UTC, 2 confirmations at the time of the check). Locktime **977,641** (the event end block). Size 870 bytes, fee **872 sat**, version 2.
- Input 0: the pact's Accepted address (starts `pdq7fwsfjlswcgc4...`), 10,000 sat. Output 0: the claim-stage address (starts `pvgt202f8tmtgyw7...`), **10,000 sat**: the whole pact amount stays in the contract.
- Input 1 (wallet sponsor) 9,327 sat, output 1 (change) 8,455 sat. The difference is the fee, paid by the sponsor input.

**C3 payout `9cf26120...f8690`**
- Confirmed in block **977,647** (17:02 UTC, 1 confirmation at the time of the check). Locktime **0**, size 807 bytes, fee **809 sat**, version 2.
- Input 0: the claim-stage address (`pvgt202f8tmtgyw7...`), 10,000 sat. Output 0: `qpgcz25vg4f2rqd95qgs5qquwkzcuumy6gn4yz9ecs` (the worker's payout address), **10,000 sat**: the whole pact amount goes to the worker.
- Input 1 (sponsor) 8,455 sat, output 1 (change) 7,646 sat. The fee, 809 sat, is not taken from the pact money.
- The A3 output was spent by C3 in the very next block, so the C3 input is exactly the A3 claim-stage output.

## What this shows
- The organizer can release the money to the worker's payout address at the claim stage with their own role key only, without waiting for the 432-block period, and the network accepts it. The full pact amount reaches the worker and the fee does not touch it.
- With M1-M4, F1, A1, F2, A3, A2 and C3 have now run on mainnet with a real wallet. A3 has run twice.

## What this does NOT show
- The same wallet and the same payout address were used for the worker and the organizer's refund, so this does not show two separate people. The two roles did run in two separate browsers (the organizer role key lives only in the private window), so each signature came from a different role key.
- C1 (the worker collects after 432 blocks) is planned for 19 Nov and has its own evidence. C2, A4 and D1-D6 have not run on mainnet with a real wallet.
