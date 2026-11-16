# M3 - first real-wallet claim after the event end on mainnet (A3: the worker claims the pay)

Evidence level: **real wallet (Paytaca via WizardConnect) + mainnet**. Path tested: **A3** (Accepted -> Requested, timelock on the event end block).
Date: 2026-11-16 (Istanbul, about 16:30). Network: Bitcoin Cash mainnet.

## What was done
- A test pact "Test 3 claim" (10,000 sat, event end = block 977,616, payout/refund address = the tester's own Paytaca address) was created, funded with exactly 10,000 sat and accepted (F1) with the real wallet earlier the same day.
  - Funding outpoint: `c8d0ecd4988dc5f9c40d81d260e3e3a8ea687ecb37c9835141189b5f018b02cc:0`
  - F1 accept transaction: `0d819343e6e96ccc36069be2dfb8b23429e0f51e0d4d1f786142dbc2d12e0fbf`
- The organizer did not pay. After the chain passed block 977,616 the worker pressed "Claim the pay" in the app; Paytaca signed the sponsor input over WizardConnect, the app verified the answer and broadcast.
  - **A3 claim transaction:** `62fbc1aba0731717ff6807ebfb5dbf39f71f7851b26e446fa0e853925bb900cf`
- The page then showed the pact as "Claimed", with the money at the claim-stage (Requested) address.

## Block-explorer check (3xpl.com, 2026-11-16)
- Confirmed in block **977,619** (1 confirmation at the time of the check). Locktime of the transaction: **977,616** (the event end block).
- Input 0: the pact's Accepted address, 10,000 sat. Output 0: the claim-stage address `pv6pwugt7frymuv3elyz5h002ynxpf5cdmdpkcfejs5eyn8hlvycvtvgwzv2v`, **10,000 sat** (the whole pact amount stays in the contract).
- Input 1 / output 1: the wallet's fee-sponsor input (10,000 sat) and its change (9,128 sat). The fee, 872 sat, is paid by the sponsor input, not from the pact money.
- Size 870 bytes, fee 872 sat (about 1 sat/byte), version 2.

## What this shows
- A real wallet signs the A3 path and the network accepts it once the event end block has passed; the pact money does not leave the contract, it moves to the claim stage.
- Together with M1 and M2, F1, A1, F2 and A3 have now run on mainnet with a real wallet.

## What this does NOT show
- C1 (the worker collects after 432 blocks, about 3 days) has not run yet: the claim output must first have 432 confirmations (earliest at chain tip 978,050). It is planned on this same pact and will get its own evidence file (or an addition here) if it runs.
- A2, A4, C2-C4 and D1-D6 have not run on mainnet with a real wallet.
- The same wallet owned both roles. The "organizer stays silent" case was simulated by simply not paying.
