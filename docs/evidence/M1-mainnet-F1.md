# M1 - first real wallet signature and first mainnet transaction (F1 accept)

Evidence level: **real wallet (Paytaca via WizardConnect) + mainnet**. Path tested: **F1 only**.
Date: 2026-11-16 (Istanbul, about 13:35). Network: Bitcoin Cash mainnet.

## What was done
- A test pact "Test 2" (10,000 sat, tEnd block 977781, refund/payout address = the tester's own Paytaca address) was created in the web app.
- The organizer funded it with exactly 10,000 sat in one payment to the pact's funding address (P2SH32).
  - Funding outpoint: `6e715ef3ff155358cdcc1283bd5eeb194b9c6a51e4c679477fbeb205ccc86b4a:0`
- The worker pressed "Accept the pact". The app built the F1 transaction, Paytaca (connected over WizardConnect) signed the fee-sponsor input, the app verified the wallet's answer and then broadcast it.
  - **F1 accept transaction:** `e5d41659ee5bba9393cf2b980a3b6dbd32f68910928a8902711b05fb39bb592b`
  - The app then showed the pact money at `e5d41659…592b:0` (the Accepted contract address), status "Accepted".

## What this shows
- Paytaca signs a GigPact transaction (sponsor input, sighash 0x61) and the signature is accepted by the network.
- The F1 path works on the real network with the Funded contract of this repository.

## What this does NOT show
- No other path (F2, A1-A4, C1-C4, D1-D6) has run on mainnet or with a real wallet.
  F2 (cancel) has R-VM / regtest / software-wallet tests and a UI button, but the button has not been used with a real wallet yet.
- The money of this test pact stays at the Accepted address until an exit path is run (A3 claim after block 977781 or A1 pay); those buttons are not built yet.

## Incident on the way (kept for honesty)
- An earlier test pact ("Test set") received a payment of 30,000 sat instead of 10,000 sat (wrong amount typed in the wallet).
  The contract takes F1 only for the exact amount, so it could not be accepted. The F2 cancel button was written to take it back,
  but the organizer's key lived only in a private browser window that was closed in the meantime, so that key is lost and the 30,000 sat
  stay locked at that pact's funding address. Fix shipped afterwards: organizer key backup box and key restore.
