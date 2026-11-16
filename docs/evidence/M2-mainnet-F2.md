# M2 - first real-wallet cancel on mainnet (F2: the organizer takes the money back)

Evidence level: **real wallet (Paytaca via WizardConnect) + mainnet**. Path tested: **F2**.
Date: 2026-11-16 (Istanbul, about 15:19). Network: Bitcoin Cash mainnet.

## What was done
- A test pact "Test 4 cancel" (10,000 sat, refund/payout address = the tester's own Paytaca address) was created in the web app.
- The organizer funded it with exactly 10,000 sat in one payment.
  - Funding outpoint: `0412dcec226bf95107c828f50713153ba55aefbebe572226868f119eb5418a7c:0`
- Before the worker accepted, the organizer (browser holding key V) connected Paytaca over WizardConnect and pressed "Take the money back".
  - **F2 cancel transaction:** `ad5a0abff7f6c8695268cd666aa6f6ed7510b684198f657e2bbdf36469f2df03`
  - The wallet signed the sponsor input, the app verified the answer and broadcast it.

## Block-explorer check (3xpl.com, 2026-11-16)
- Confirmed in block **977,609** (1 confirmation at the time of the check; first seen in the mempool at 12:19 UTC).
- Input 0: the pact's funding address, 10,000 sat. Output 0: the organizer's refund address, **10,000 sat** (the whole pact amount).
- Input 1 / output 1: the wallet's fee-sponsor input and its change. The 663 sat fee is paid by the sponsor input, not from the pact money.
- Size 661 bytes, fee 663 sat (about 1 sat/byte), version 2, locktime 0.
- Paytaca showed the same transaction as received: net +9,337 sat in the wallet (10,000 refunded minus the 663 sat fee that the wallet paid).

## What this shows
- A real wallet signs the F2 cancel path and the network accepts it; the money returns in full to the refund address set in the pact.
- Together with M1, the paths F1, A1 and F2 have now run on mainnet with a real wallet.

## What this does NOT show
- A2, A3, C1-C4 and D1-D6 have not run on mainnet with a real wallet (A3 and C1 are planned next on a separate test pact).
- The same wallet owned both roles (organizer and worker) in this test.
- The page did not show a "Cancelled" state for this run: the cancel was made with a build that had no cancel marker, so the page showed "Waiting for funding" again. This was fixed afterwards (commit 1abe426) and applies to later cancels.
