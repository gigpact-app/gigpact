# M7b - full flow again with Paytaca on the current build: fund, accept (F1), pay (A1) on mainnet

Evidence level: **real wallet (Paytaca via WizardConnect) + mainnet**. Paths tested: **F1** (the worker accepts) and **A1** (the organizer pays the worker), after a plain funding send.
Date: 2026-11-18 (Istanbul, about 16:50-17:35). Network: Bitcoin Cash mainnet. Wallet: Paytaca. Build: the live app after commit `dbe39cd` (wallet scan fix) on top of `29885d8` (confirmation gate for the funding output). Layout and text commits that followed the same day do not change the transactions.

## Why this run
M1-M6 were made with Paytaca on the 16 November build, M7 with Selene on 17 November. On 18 November the wallet scan of the worker page was fixed (a Paytaca change coin sat at change index 31 and was not found, the page showed a wallet check of 0 coins). This run shows the whole flow again, with the fix, with the same wallet that exposed the problem.

## What was done
- A test pact "Test Wednesday" (10,000 sat, event end = block 977,936) was created on the live app (https://gigpact-app.github.io/gigpact/). The worker payout address was a plain Paytaca receive address (`bitcoincash:qq7u4y48mga4s4rt02wqwt47r3fypahry544rf8xcq`). The organizer used a private browser window.
- **Fund:** the pact's funding address (starts `pvpxwr5rprtsjs...`) was paid with exactly 10,000 sat from Paytaca (plain send).
  - Funding transaction: `58f52a5df7fa01b777ed0d6ada4fd7a30d08665c18d8df48517b9280a076f6c8` (output 0)
- **Worker wallet check:** with Paytaca connected over WizardConnect the worker page first found 0 coins (before the fix). After the scan fix it found 1 plain coin (2,631,490 sat, 180 addresses scanned).
- **F1 accept:** the worker pressed accept. Paytaca signed the sponsor input, the worker role key signed the pact input in the browser, the app verified the answer and broadcast.
  - F1 transaction: `8c47d137728a4cf4947a0e712483baabf8245a2c88587f8c619f9409d5acdf1a`
- **A1 pay:** the organizer page connected to the same Paytaca session and pressed "Pay the worker now". Paytaca signed the sponsor input, the organizer role key signed the pact input.
  - A1 transaction: `fe9540e9bafe97f51b0092271c523761db66cf9a3a2aedfff14b10d4d1b73cb9`
- The page then showed the pact as "Settled (A1)". The worker page said the pact is finished.

## Block-explorer check (bchexplorer.info, 2026-11-18, about 14:38 UTC)
**Fund `58f52a5d...f6c8`**
- Confirmed, block time 13:52:03 UTC (4 confirmations at the time of the check), size 229 bytes, fee **234 sat**.
- Input 0: a Paytaca address, 2,641,724 sat. Output 0: the pact's funding address, **10,000 sat**. Output 1: change to a new Paytaca address, 2,631,490 sat.

**F1 accept `8c47d137...df1a`**
- Confirmed, block time 14:30:27 UTC (2 confirmations at the time of the check), size 671 bytes, fee **673 sat**.
- Input 0: the pact's funding address, 10,000 sat. Output 0: the Accepted-stage address (starts `pdfg4fmtesc49xja...`), **10,000 sat**: the whole pact amount stays in the contract.
- Input 1 (Paytaca sponsor) 2,631,490 sat (the change of the funding transaction), output 1 (change) 2,630,817 sat. The fee is not taken from the pact money.

**A1 pay `fe9540e9...3cb9`**
- Confirmed in the same block as F1, block time 14:30:27 UTC (2 confirmations), size 860 bytes, fee **862 sat**.
- Input 0: the Accepted-stage address (`pdfg4fmtesc49xja...`), 10,000 sat (exactly the F1 output). Output 0: `qq7u4y48mga4s4rt02wqwt47r3fypahry544rf8xcq` (the payout address), **10,000 sat**: the whole pact amount.
- Input 1 (Paytaca sponsor) 2,630,817 sat (the change of F1), output 1 (change) 2,629,955 sat.
- Paytaca showed the payout as received 0.00009138 BCH: 10,000 sat paid out minus the 862 sat fee, because the same wallet paid the fee.

## What this shows
- The full flow fund, F1, A1 works on mainnet with Paytaca on the current build, and the sponsor coin is found by the fixed wallet scan (the sponsor coin of F1 sat at a change address that the old scan range missed).
- The pact money stays whole through the chain (10,000 sat at every stage) and the wallet fees (673 and 862 sat) are paid from the wallet's own coins.
- F1 and A1 were confirmed in the same block.

## What this does NOT show
- The same wallet owned the fee input, the funding source and the payout address, and both roles ran in two browser windows of one person. This does not show two separate people.
- The "Waiting for 1 confirmation" state after funding was not observed in this run (a block arrived within seconds of the broadcast, so the page never showed the waiting state).
- Block heights were not recorded (the explorer page shows block time and confirmations only).
- Other paths: F2, A3, A2, C3, C4 were run with Paytaca earlier (M2-M6). C1 is planned next; C2, A4 and D1-D6 have not run on mainnet with a real wallet.
