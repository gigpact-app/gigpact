# M1 - first real wallet signatures and first mainnet transactions (F1 accept, A1 pay)

Evidence level: **real wallet (Paytaca via WizardConnect) + mainnet**. Paths tested: **F1 and A1 only**.
Date: 2026-11-16 (Istanbul, about 13:35). Network: Bitcoin Cash mainnet.

## What was done
- A test pact "Test 2" (10,000 sat, tEnd block 977781, refund/payout address = the tester's own Paytaca address) was created in the web app.
- The organizer funded it with exactly 10,000 sat in one payment to the pact's funding address (P2SH32).
  - Funding outpoint: `6e715ef3ff155358cdcc1283bd5eeb194b9c6a51e4c679477fbeb205ccc86b4a:0`
- The worker pressed "Accept the pact". The app built the F1 transaction, Paytaca (connected over WizardConnect) signed the fee-sponsor input, the app verified the wallet's answer and then broadcast it.
  - **F1 accept transaction:** `e5d41659ee5bba9393cf2b980a3b6dbd32f68910928a8902711b05fb39bb592b`
  - The app then showed the pact money at `e5d41659…592b:0` (the Accepted contract address), status "Accepted".

## Second step the same day: A1 pay (about 13:50)
- The organizer (browser holding key V) connected Paytaca over WizardConnect (a separate pairing in that browser) and pressed "Pay the worker now".
  - **A1 pay transaction:** `f03fc1ef4ddd8b007c3a109f608b96e999d0b95631575e9a66258ece495ba163`
  - 10,000 sat moved from the Accepted contract to the worker's payout address; the page then showed "Settled".
- So the happy path fund -> accept -> pay has run once on mainnet with a real wallet.

## What this shows
- Paytaca signs a GigPact transaction (sponsor input, sighash 0x61) and the signature is accepted by the network.
- The F1 and A1 paths work on the real network with the Funded and Accepted contracts of this repository.

## What this does NOT show
- No other path (F2, A2-A4, C1-C4, D1-D6) has run on mainnet or with a real wallet. A2 and A3 have buttons and software-wallet tests only.
  F2 (cancel) has R-VM / regtest / software-wallet tests and a UI button, but the button has not been used with a real wallet yet.
- Block-explorer check (3xpl.com, 2026-11-16): all three transactions are confirmed. Funding and F1 accept are in block 977,601; A1 pay is in block 977,604. Sizes/fees: funding 229 B / 234 sat, F1 671 B / 673 sat, A1 860 B / 862 sat.

## Incident on the way (kept for honesty)
- An earlier test pact ("Test set") received a payment of 30,000 sat instead of 10,000 sat (wrong amount typed in the wallet).
  The contract takes F1 only for the exact amount, so it could not be accepted. The F2 cancel button was written to take it back,
  but the organizer's key lived only in a private browser window that was closed in the meantime, so that key is lost and the 30,000 sat
  stay locked at that pact's funding address. Fix shipped afterwards: organizer key backup box and key restore.
