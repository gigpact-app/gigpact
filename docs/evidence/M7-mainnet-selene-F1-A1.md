# M7 - a second wallet: Selene signs the accept (F1) and the pay (A1) on mainnet

Evidence level: **real wallet (Selene via WizardConnect) + mainnet**. Paths tested: **F1** (the worker accepts) and **A1** (the organizer pays the worker). The pact was also funded from Selene with a plain send (QR code).
Date: 2026-11-17 (Istanbul, about 13:30-14:10). Network: Bitcoin Cash mainnet. Wallet: Selene Wallet v2026.10.02 on an iPhone, WizardConnect (menu: Wallet > Wallet tools > WizardConnect). This is the second wallet after Paytaca (M1-M6).

## What was done
- A test pact "Selene test" (10,000 sat, event end = block 977,800) was created on the live app (https://gigpact-app.github.io/gigpact/). The worker payout address and the organizer's refund address were the same plain Selene receive address (`bitcoincash:qp35422mvw44d3qz5h8l2nehxe5xvhlz4q57zhl2z2`). The organizer used a private browser window.
- **Fund:** the pact's funding address (starts `pv0vtr3pq3nvmrc9...`) was paid with exactly 10,000 sat by scanning the app's QR code in Selene. The app showed the pact as Funded.
  - Funding transaction: `555261a1fac83ed6e6b6bfb9ffdd922c588d8403cb8fff4a45aac3e3ceb60e2a` (output 0)
- **F1 accept:** the worker connected Selene over WizardConnect and pressed accept. Selene signed the sponsor input, the worker role key signed the pact input in the browser, the app verified the answer and broadcast.
  - F1 transaction: `fca0570a7e03052496d84ad221866371f2c235305a666da54a60df155d7cc0b8`
- **A1 pay:** the organizer page connected to Selene (the same WizardConnect session) and pressed "Pay the worker now". Selene signed the sponsor input, the organizer role key signed the pact input.
  - A1 transaction: `05690aefd91a7d5fdf15395b1768dada40af3ba80d652550dd5b1bc1931f7eaa`
- The page then showed the pact as "Settled (A1)".

## Block-explorer check (3xpl.com, 2026-11-17)
**Fund `555261a1...0e2a`**
- Confirmed in block **977,740** (11:00 UTC), size 229 bytes, fee **229 sat**, version 2, locktime 0.
- Input 0: a Selene address, 959,555 sat. Output 0: the pact's funding address, **10,000 sat**. Output 1: change to a Selene address, 949,326 sat.

**F1 accept `fca0570a...c0b8`**
- Confirmed in block **977,740** (11:00 UTC), size 671 bytes, fee **673 sat**, version 2, locktime 0.
- Input 0: the pact's funding address, 10,000 sat. Output 0: the Accepted-stage address (starts `pwwvzhs52apkf8hh...`), **10,000 sat**: the whole pact amount stays in the contract.
- Input 1 (Selene sponsor) 949,326 sat, output 1 (change) 948,653 sat. The fee is not taken from the pact money.

**A1 pay `05690aef...f7eaa`**
- Confirmed in block **977,741** (11:10 UTC), size 860 bytes, fee **862 sat**, version 2, locktime 0.
- Input 0: the Accepted-stage address (`pwwvzhs52apkf8hh...`), 10,000 sat. Output 0: `qp35422mvw44d3qz5h8l2nehxe5xvhlz4q57zhl2z2` (the payout address), **10,000 sat**: the whole pact amount.
- Input 1 (Selene sponsor) 948,653 sat, output 1 (change) 947,791 sat.
- The A1 input is exactly the F1 output, so the money moved Funded -> Accepted -> worker without leaving the contract rules.

## What this shows
- A second, independent wallet (Selene) pairs with the app over WizardConnect and signs the sponsor input of both the accept and the pay transaction, and the network accepts them. The pact money is untouched by the wallet fee.
- The pact can be funded from Selene with a plain send (QR scan); the app recognised the funding.
- With M1-M6, **F1 and A1 now run on mainnet with two different wallets** (Paytaca and Selene).

## What this does NOT show
- One wallet owned the fee input and the payout address for both roles, so this does not show two separate people. The two roles ran in two separate browser windows, so each pact signature came from a different role key.
- Only F1 and A1 (and the funding send) were run with Selene. The other paths (F2, A3, A2, C3, C4) were run with Paytaca only. C1 is planned for 19 Nov; C2, A4 and D1-D6 have not run on mainnet with a real wallet.
- Selene's WizardConnect session was used on a single pact. Selene rejects token-aware (`z...`) addresses in the app's address field, so the plain `q...` form of the same address was used.
