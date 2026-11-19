# M8 - collect the pay after the waiting period on mainnet (C1), real wallet

Evidence level: **real wallet (Paytaca via WizardConnect) + mainnet**, through the app's own "Collect the pay" button. Path tested: **C1** (Requested -> worker's payout address, after 432 blocks, no organizer signature).
Date: 2026-11-19 (Istanbul, about 20:30; 17:30 UTC). Network: Bitcoin Cash mainnet.

## What was done
- The pact is the one of [M3](M3-mainnet-A3.md): "Test 3 claim", 10,000 sat, event end block 977,616. Its claim (A3) is transaction `62fbc1aba0731717ff6807ebfb5dbf39f71f7851b26e446fa0e853925bb900cf`, confirmed in block 977,619. The money sat at the claim-stage address `pv6pwugt7frymuv3elyz5h002ynxpf5cdmdpkcfejs5eyn8hlvycvtvgwzv2v`.
- C1 needs the claim output to have 432 confirmations. With the claim in block 977,619 that is chain tip 978,050 at the earliest; the chain tip was already 978,052 at 17:03 UTC, before the run.
- The original pact link of that test had not been kept. The link was rebuilt from the chain alone with `scripts/recover-pact-link.mjs`: the claim transaction carries the accepted-stage script, which holds both public keys, both payout locks and the end block. The rebuilt pact reproduces the claim-stage address above exactly, so it is the same pact. The worker key of that test was still in the browser; the collect step does not need it.
- The page showed the pact as "Claimed: waiting period" with the button "Collect the pay (after the waiting period)". Paytaca was connected over WizardConnect. The tester rejected the first request in the wallet; the app reported "Your wallet did not complete the request (User rejected). Nothing was sent." and nothing was broadcast. The second request was approved. Paytaca signed only its own fee-sponsor input.
  - **C1 transaction:** `b1bc0584f5682d3d2b975632f48b8638ace115d0445b1ec4e7697a0869a9b53d`
- The page then showed "Settled (C1)" and the payout address.

## Block-explorer check (3xpl.com, 2026-11-19)
- Input 0: the claim-stage address, **10,000 sat**. Output 0: the worker's payout address `qpgcz25vg4f2rqd95qgs5qquwkzcuumy6gn4yz9ecs`, **10,000 sat** (the whole pact amount).
- Input 1: the wallet's fee input, 9,337 sat. Output 1: its change, 8,594 sat. The fee, 743 sat, comes from the wallet's input, not from the pact money.
- Size 741 bytes, fee rate 1 sat/byte, version 2, locktime 0.
- Confirmed in block **978,057 (1 confirmation at the time of the check)**. The first look at the explorer, 3 minutes after the broadcast, showed it in the mempool.

## What this shows
- A real wallet pays the network fee of a collect transaction and the network accepts it once the claim output has waited 432 blocks; the organizer does not sign anything. This is the silent-organizer path end to end on mainnet: claim after the event end (A3, M3), then collect (C1).
- C1, together with M1 to M7, brings the paths run with a real wallet on mainnet to F1, A1, F2, A3, A2, C3, C4 and C1.

## What this does NOT show
- The same tester played both roles with their own wallets. The "organizer stays silent" case was simulated by not paying.
- Selene was not used for C1.
- A4 and D4 (the fallbacks after about 7 and 14 days) have not run on mainnet and cannot before the submission deadline. C2 and the arbiter decisions ran on mainnet by script, see [M9](M9-arbiter-run.md).
