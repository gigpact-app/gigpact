# M9: dispute paths on mainnet (script run, not through the app)

Date: 2026-11-19. Event end block 978049. Run by `scripts/mainnet-arbiter-run.mjs` with local keys, using the same library as the app (`src/chain.mjs`, `src/spend.mjs`, `src/k17.mjs`). The arbiter key of these pacts is a test key made for this run; it is not the `ARBITER_PK` of the app. The app has no button for any of these steps.

| Pact | Step | Path | Transaction | Fee (sat) |
|---|---|---|---|---|
| P1 (F 10000 sat, arbiter decides for the worker) | Funding payment | - | [0ad94d4c0e0f…](https://3xpl.com/bitcoin-cash/transaction/0ad94d4c0e0ffaa852198e2f07f0db4b12fd0197d60898370cf1a51ff1838ddb) | 500 |
| P1 (F 10000 sat, arbiter decides for the worker) | F1 accept | F1 | [87dd0fd66d70…](https://3xpl.com/bitcoin-cash/transaction/87dd0fd66d7017ba1bf7e2d60cf80950cdf8bebba6651119f88402dc2da38c32) | 673 |
| P1 (F 10000 sat, arbiter decides for the worker) | A3 claim | A3 | [b719d2a3b419…](https://3xpl.com/bitcoin-cash/transaction/b719d2a3b419ba5bb4da169a88998bf68f1dd4bc7ef0bb9feef65cc7a8545e17) | 872 |
| P1 (F 10000 sat, arbiter decides for the worker) | C2 objectClaim | C2 | [2ac432dcd651…](https://3xpl.com/bitcoin-cash/transaction/2ac432dcd6513d2b8f3f83a07fb90dc335188b8ca09428c06c798883fa446f34) | 819 |
| P1 (F 10000 sat, arbiter decides for the worker) | D1 decision | D1 | [a406ccd1cbe4…](https://3xpl.com/bitcoin-cash/transaction/a406ccd1cbe43acb1add935b1bf6071c2baec52de797290e40d796f93c7d62f5) | 1209 |
| P2 (F 10100 sat, arbiter splits) | Funding payment | - | [5156955eddb0…](https://3xpl.com/bitcoin-cash/transaction/5156955eddb091a004fb7e3c8fbe68a8d4fecf067e65bf37bb566b94d0489b59) | 500 |
| P2 (F 10100 sat, arbiter splits) | F1 accept | F1 | [dcaee2b14d26…](https://3xpl.com/bitcoin-cash/transaction/dcaee2b14d26b585afded9e309cb6baaddec1ed0fbd66eb1a6e6675b2ece2963) | 673 |
| P2 (F 10100 sat, arbiter splits) | A3 claim | A3 | [bf541b89b939…](https://3xpl.com/bitcoin-cash/transaction/bf541b89b93954de43c326a4dec13e3756c23440d00fc9ebb0874187371fa2ab) | 872 |
| P2 (F 10100 sat, arbiter splits) | C2 objectClaim | C2 | [8c6a108bd83f…](https://3xpl.com/bitcoin-cash/transaction/8c6a108bd83fc7d6fb930dc017f906448a15bdb950b282c85b9aa90cd8d55194) | 819 |
| P2 (F 10100 sat, arbiter splits) | D3 decision | D3 | [acdd71f95c11…](https://3xpl.com/bitcoin-cash/transaction/acdd71f95c11a002fc73ee8985dbb4dc045ba13d1c77fb21e522cfa0d17bf16d) | 1243 |
| P3 (F 10200 sat, arbiter decides for the organizer) | Funding payment | - | [3797dbf685e7…](https://3xpl.com/bitcoin-cash/transaction/3797dbf685e77f487f24849dc0d0ada7853e7c43b1547147f15ce96baa8b1a2f) | 500 |
| P3 (F 10200 sat, arbiter decides for the organizer) | F1 accept | F1 | [d40efcc0525c…](https://3xpl.com/bitcoin-cash/transaction/d40efcc0525cbb698558def917e629a655464a16d8da6885a23c2c999a042c42) | 673 |
| P3 (F 10200 sat, arbiter decides for the organizer) | A3 claim | A3 | [998100ea26aa…](https://3xpl.com/bitcoin-cash/transaction/998100ea26aa7ac661c459fc2b28a4c7ff639a4b38530902b2bfcdf578b73f87) | 872 |
| P3 (F 10200 sat, arbiter decides for the organizer) | C2 objectClaim | C2 | [49118d1f06d2…](https://3xpl.com/bitcoin-cash/transaction/49118d1f06d2bfd2d68fbb11d7610e002a608d4dd0e77d942a34572d65e4ba5e) | 819 |
| P3 (F 10200 sat, arbiter decides for the organizer) | D2 decision | D2 | [98d299da39b1…](https://3xpl.com/bitcoin-cash/transaction/98d299da39b1f5170aace65e22ce4b45329991e11cadce6bfbcf5d82bfb791e6) | 1209 |
| P4 (F 10300 sat, organizer pays out) | Funding payment | - | [d031609a8347…](https://3xpl.com/bitcoin-cash/transaction/d031609a8347dde5009cf2db297cddeebbb60022087a9bfa88d6d7457a000d81) | 500 |
| P4 (F 10300 sat, organizer pays out) | F1 accept | F1 | [bea016e948f7…](https://3xpl.com/bitcoin-cash/transaction/bea016e948f779b6c8aa707c7e769b3fcbe847a8506cceb5ffbc3ce8321ffc3d) | 673 |
| P4 (F 10300 sat, organizer pays out) | A3 claim | A3 | [22bc890ddebc…](https://3xpl.com/bitcoin-cash/transaction/22bc890ddebca1b29e74edd65c5fbec5987ce8aefcec0c4c5b1da6fa40c260e2) | 872 |
| P4 (F 10300 sat, organizer pays out) | C2 objectClaim | C2 | [4e7bf2fde001…](https://3xpl.com/bitcoin-cash/transaction/4e7bf2fde001d9258f1e47dd45a6da907b9e2355c7b0fdeca2e4e12f5d4d8c08) | 819 |
| P4 (F 10300 sat, organizer pays out) | D5 decision | D5 | [2a4c93dabf02…](https://3xpl.com/bitcoin-cash/transaction/2a4c93dabf028b2a6fc956504f34eca16d12f3ab131fc5029ada47b5cde3506d) | 1175 |
| P5 (F 10400 sat, worker waives) | Funding payment | - | [f80950358fd8…](https://3xpl.com/bitcoin-cash/transaction/f80950358fd812b22e3c855fc748dcb1a164b36a81eb74511ba88062897b80a8) | 500 |
| P5 (F 10400 sat, worker waives) | F1 accept | F1 | [d14829f557eb…](https://3xpl.com/bitcoin-cash/transaction/d14829f557eb62aa1be5252fba611efb910e550269bd8358eadb06eeae272c77) | 673 |
| P5 (F 10400 sat, worker waives) | A3 claim | A3 | [4b012b735886…](https://3xpl.com/bitcoin-cash/transaction/4b012b735886bf1da9612fde48a61771391bccc6af461faeb0e117b3e02c79fb) | 872 |
| P5 (F 10400 sat, worker waives) | C2 objectClaim | C2 | [aeb7e85e5119…](https://3xpl.com/bitcoin-cash/transaction/aeb7e85e511972e6843191c5fce89afecc82b569b112a955c9bab21160de90db) | 819 |
| P5 (F 10400 sat, worker waives) | D6 decision | D6 | [234ae97c3602…](https://3xpl.com/bitcoin-cash/transaction/234ae97c3602aed6caf47f0c6bd3c968fa7ccd9c767b24e4ff2a2a13ce8d5992) | 1175 |

Confirmation check, 19 November 2026 about 17:50 UTC: all 25 transactions are in blocks (the funding and accept steps had 7 to 11 confirmations, the claim, objection and decision steps 4 each).

Full ids:

```
P1 fund 0ad94d4c0e0ffaa852198e2f07f0db4b12fd0197d60898370cf1a51ff1838ddb
P1 F1 87dd0fd66d7017ba1bf7e2d60cf80950cdf8bebba6651119f88402dc2da38c32
P1 A3 b719d2a3b419ba5bb4da169a88998bf68f1dd4bc7ef0bb9feef65cc7a8545e17
P1 C2 2ac432dcd6513d2b8f3f83a07fb90dc335188b8ca09428c06c798883fa446f34
P1 D1 a406ccd1cbe43acb1add935b1bf6071c2baec52de797290e40d796f93c7d62f5
P2 fund 5156955eddb091a004fb7e3c8fbe68a8d4fecf067e65bf37bb566b94d0489b59
P2 F1 dcaee2b14d26b585afded9e309cb6baaddec1ed0fbd66eb1a6e6675b2ece2963
P2 A3 bf541b89b93954de43c326a4dec13e3756c23440d00fc9ebb0874187371fa2ab
P2 C2 8c6a108bd83fc7d6fb930dc017f906448a15bdb950b282c85b9aa90cd8d55194
P2 D3 acdd71f95c11a002fc73ee8985dbb4dc045ba13d1c77fb21e522cfa0d17bf16d
P3 fund 3797dbf685e77f487f24849dc0d0ada7853e7c43b1547147f15ce96baa8b1a2f
P3 F1 d40efcc0525cbb698558def917e629a655464a16d8da6885a23c2c999a042c42
P3 A3 998100ea26aa7ac661c459fc2b28a4c7ff639a4b38530902b2bfcdf578b73f87
P3 C2 49118d1f06d2bfd2d68fbb11d7610e002a608d4dd0e77d942a34572d65e4ba5e
P3 D2 98d299da39b1f5170aace65e22ce4b45329991e11cadce6bfbcf5d82bfb791e6
P4 fund d031609a8347dde5009cf2db297cddeebbb60022087a9bfa88d6d7457a000d81
P4 F1 bea016e948f779b6c8aa707c7e769b3fcbe847a8506cceb5ffbc3ce8321ffc3d
P4 A3 22bc890ddebca1b29e74edd65c5fbec5987ce8aefcec0c4c5b1da6fa40c260e2
P4 C2 4e7bf2fde001d9258f1e47dd45a6da907b9e2355c7b0fdeca2e4e12f5d4d8c08
P4 D5 2a4c93dabf028b2a6fc956504f34eca16d12f3ab131fc5029ada47b5cde3506d
P5 fund f80950358fd812b22e3c855fc748dcb1a164b36a81eb74511ba88062897b80a8
P5 F1 d14829f557eb62aa1be5252fba611efb910e550269bd8358eadb06eeae272c77
P5 A3 4b012b735886bf1da9612fde48a61771391bccc6af461faeb0e117b3e02c79fb
P5 C2 aeb7e85e511972e6843191c5fce89afecc82b569b112a955c9bab21160de90db
P5 D6 234ae97c3602aed6caf47f0c6bd3c968fa7ccd9c767b24e4ff2a2a13ce8d5992
```

## Payouts of the last step (amounts recorded by the script from the transaction it signed and broadcast)

| Pact | Path | Outputs in sat | Expected by the contract | Match |
|---|---|---|---|---|
| P1 | D1 | 8000, 2000 | worker 8000, arbiter 2000 | yes |
| P2 | D3 | 4050, 4050, 2000 | worker 4050, organizer 4050, arbiter 2000 | yes |
| P3 | D2 | 8200, 2000 | organizer 8200, arbiter 2000 | yes |
| P4 | D5 | 10300 | worker 10300 (organizer pays out) | yes |
| P5 | D6 | 10400 | organizer 10400 (worker waives) | yes |

Each row is the output list of the signed transaction; the network accepted every transaction under the id the script computed. These runs prove that the library builds valid spends of these paths on mainnet; they do not show a button in the app (there is none). Paths A4 (about 7 days after the end) and D4 (about 14 days after a dispute) cannot be run on mainnet before the deadline and are covered by regtest and the VM only.
