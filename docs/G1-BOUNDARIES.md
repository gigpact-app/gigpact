# G1 security boundaries (recorded 2026-11-14, after cross-review)

Evidence level of G1: source compiled with cashc 0.14.0 on two machines (hashes match). No path executed (no R-VM, regtest, wallet or mainnet evidence yet).

- G1-01 (fixed in source): `Funded.cancel` (F2) no longer requires `F >= dustSafe`. At consensus-script level the contract no longer blocks a refund of a sub-DUST_SAFE UTXO. This is not a recovery guarantee: the refund still needs a sponsor input for the fee and network relay policy must accept the output (measured in G7). Tests needed in G2: F2 below/equal DUST_SAFE, amounts different from fundedValue, network dust-policy limits.
- G1-02 (boundary): the contracts verify the role signature with `checkSig` but do NOT restrict the signature hash type on-chain. Sighash 0x61 is a transaction-builder (G6) policy, not a contract guarantee. It must not be presented as an on-chain guarantee.
- G1-03 (boundary): constructor parameters (acceptedLock, requestedLock, disputePayLock, disputeRefundLock, lockV/W/A, tA4, fA, phi, ...) are not cross-checked inside the contracts. Their consistency is enforced by the transaction library when it builds the chain (I12). I12 is NOT yet verified: no transaction library or test exists yet. Source compilation does not close this dependency.
- G1-04 (boundary): K17 declared-funding-outpoint rule is app/tx-library layer, not coded in the contracts. R-VM tests alone cannot verify K17 (the contract does not see it); it needs the transaction library plus job-identity tests, including fake, duplicate and third-party funding.
- G1-05 (boundary): DUST_SAFE = 1000 sat is an unmeasured assumption. No recovery guarantee for arbitrary standard outputs before G7 measurement.
- PUSD mode is not implemented. BCH mode only.
