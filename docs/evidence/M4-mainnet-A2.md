# M4 - the worker waives right after accepting, on mainnet (A2: the worker gives the money back)

Evidence level: **real wallet (Paytaca via WizardConnect) + mainnet**. Path tested: **A2** (Accepted -> money back to the organizer's refund address, signed by the worker only, no timelock).
Date: 2026-11-16 (Istanbul, about 18:30-18:45). Network: Bitcoin Cash mainnet.

## What was done
- A test pact "Test 7 A2" (10,000 sat, event end = block 977,644, payout and refund address = the tester's own Paytaca addresses) was created in the app, funded with exactly 10,000 sat (one payment) and accepted (F1) with the real wallet.
  - F1 accept transaction: `350e2de18005ac0ef60ae72e4a7df23421f8ae80f8efd9d149b59395dc1fb9d0` (its output 0 is the pact money at the Accepted address)
- The worker then pressed "Waive: give the money back" in the app. Paytaca signed the sponsor input over WizardConnect, the worker role key signed the pact input in the browser, the app verified the answer and broadcast.
  - **A2 waive transaction:** `611a52917f957a0ea806e72cbd50c0ffb3f5352573463c404e4b1d2f6ec8fd7c`
- The page then showed the pact as "Settled (A2)" and the money as sent to the refund address.

## Block-explorer check (3xpl.com, 2026-11-16, 15:43 UTC)
- Confirmed in block **977,635** (1 confirmation at the time of the check). Locktime **0** (A2 has no time condition). Version 2, size 860 bytes, fee **862 sat** (1 sat/byte).
- Input 0: the pact's Accepted address (starts `pd60lrwh5thwft6762n697...`), **10,000 sat**.
- Output 0: `qpgcz25vg4f2rqd95qgs5qquwkzcuumy6gn4yz9ecs` (the organizer's refund address), **10,000 sat**: the whole pact amount is returned.
- Input 1 / output 1: the wallet's fee-sponsor input (3,587,140 sat) and its change (3,586,278 sat). The difference is the fee, 862 sat, paid by the sponsor input, not from the pact money.

## What this shows
- A real wallet signs the A2 path (worker role key in the browser plus the sponsor input in the wallet) and the network accepts it. The whole pact amount goes back to the organizer's refund address and the fee does not touch it.
- With M1-M3, F1, A1, F2, A3 and A2 have now run on mainnet with a real wallet.

## What this does NOT show
- The same wallet owned both roles (worker and organizer refund address), so this does not show two separate people. The organizer's key was only used to fund the pact through the app, not to spend.
- C1, A4, C2 and D1-D6 had not run when this note was written. C3 and C4 ran later the same day, see M5 and M6.
