# M7c - the "Waiting for 1 confirmation" gate seen live, then cancel (F2), mainnet, Paytaca

Evidence level: **real wallet (Paytaca via WizardConnect) + mainnet**, plus live observation of the app's confirmation gate. Path tested with a wallet: **F2** (the organizer cancels before the worker accepts). The funding send was a plain send from Paytaca.
Date: 2026-11-18 (Istanbul, about 17:50-19:00). Network: Bitcoin Cash mainnet. Build: the live app at commit `9169d09` (the gate itself came with `29885d8`).

## Why this run
The app does not show a pact as funded until the funding output has 1 confirmation (commit `29885d8`; unit test in `test/confirm.test.mjs`). That state had never been seen live: in the first test of the day a block arrived within seconds. This run was made to see it.

## What was done
- A test pact "Gate test" (10,000 sat, event end = block 977,947) was created on the live app. Worker payout address and the organizer's refund address were plain Paytaca addresses. The organizer used a private browser window, the worker page was opened in the normal window.
- **Fund:** the pact's funding address (starts `pwk3z6ruemgfgv...`) was paid with exactly 10,000 sat from Paytaca (plain send).
  - Funding transaction: `ad0306cc88785250c26d640c22bddf1ecc0503ed9b73590a6c9c767f3c354ec4` (output 0)
- **Observed while the funding had no confirmation** (screenshots at about 17:57-17:59 Istanbul = 14:57-14:59 UTC):
  - Organizer page: card and status "Waiting for 1 confirmation"; text "The funding payment is on the network (ad0306cc...:0) but not in a block yet. The worker can accept after the first confirmation, usually within about 10 minutes." The "Take the money back" panel was available.
  - Worker page: card "Waiting for 1 confirmation"; the "Accept the pact" button was disabled; same status text below.
  - The explorer showed the transaction without confirmations ("Confirmations: -") at the same time.
- **After the confirmation** (about 18:53 Istanbul): the organizer page showed "Funded" ("Funding found on chain: ad0306cc...:0"). The explorer shows the transaction confirmed with block time 15:23:03 UTC, so the unconfirmed period lasted about 27 minutes.
- **Wallet session:** after about an hour the stored WizardConnect session of the private window had been lost ("Connection to the wallet was lost. Trying again..."). The wallet was paired again with "Connect wallet to pay the fee".
- **F2 cancel:** the organizer pressed "Cancel and take the money back". Paytaca signed the sponsor input, the organizer role key signed the pact input. The page then showed "Cancelled".
  - F2 transaction: `fa6de2301676cf9d434b3304c1f9a596b51d4910ac2877c7658b08d7ebddbeff`

## Block-explorer check (bchexplorer.info, 2026-11-18, about 15:57 UTC)
**Fund `ad0306cc...4ec4`**
- Confirmed, block time 15:23:03 UTC (6 confirmations at the time of the check), size 229 bytes, fee **234 sat**.
- Input 0: a Paytaca address, 2,629,955 sat (a change output of the A1 transaction of M7b). Output 0: the pact's funding address, **10,000 sat**. Output 1: change to a Paytaca address, 2,619,721 sat.

**F2 cancel `fa6de230...beff`**
- Not yet confirmed at the time of the check (the explorer showed no confirmations; first seen 15:56:01 UTC), size 661 bytes, fee **663 sat**.
- Input 0: the pact's funding address, 10,000 sat (the funding output). Input 1: a Paytaca address, 10,000 sat (the fee-sponsor coin).
- Output 0: the organizer's refund address `qq89t46gnhgusme5e7yug6hqka99zuwj3uuae5v3c9`, **10,000 sat** (the whole pact amount). Output 1: change to a Paytaca address, 9,337 sat. The 663 sat fee is paid by the sponsor input, not from the pact money.

## What this shows
- The confirmation gate works live, on both sides: while the funding output is unconfirmed the pact is not shown as funded, the worker cannot accept, and the status explains why. It turned to "Funded" after the block.
- The organizer can still cancel at any time before the worker accepts; the cancel transaction was accepted by the network and the pact money (10,000 sat) went back to the refund address in full.
- F2 now ran on mainnet twice with Paytaca (M2 and this run).

## What this does NOT show
- The same wallet owned the funding source, the fee input, the refund address and the payout address; one person played both roles. This does not show two separate people.
- The F2 transaction had no confirmation yet when the explorer was checked; this note was not updated afterwards.
- The accept (F1) button was only seen disabled; no accept was attempted on the unconfirmed funding.
- The gate fails open when the Electrum answer is missing (by design, unit-tested): that case was not tested live.
- Small wording point seen: during the unconfirmed period the worker page's first sentence says "Waiting for the organizer to fund the pact"; the status text below it is the precise one.
- C1 is planned next; C2, A4 and D1-D6 have not run on mainnet with a real wallet.
