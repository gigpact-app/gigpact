You are an independent smart-contract reviewer for Bitcoin Cash (CashScript 0.14.0). Review the four contracts below as a skeptical adversary. This is a read-only code review: do not rewrite the project, do not suggest new features. Find ways money can be stolen, locked forever, redirected, or released at the wrong time. Be concrete: for every finding give (1) contract and function, (2) the exact transaction an attacker or a mistaken user would build, (3) who loses what, (4) severity (critical / high / medium / low / info), (5) whether it is a real bug, a design limitation, or a false alarm. If you are not sure, say "not sure" instead of guessing. If you find nothing in an area, say so explicitly rather than inventing issues. Do not pad the report: a short, correct report is better than a long one with weak findings.

PROJECT: GigPact is a payment guarantee for live-event workers on Bitcoin Cash. An organizer (role V, "employer") locks the agreed fee F in a contract; the worker (role W) accepts; after the event the organizer pays, or the worker claims and collects after a waiting period without anyone's approval. There are four contracts, each one state of a single UTXO that is passed from state to state: Funded -> Accepted -> Requested -> (Dispute). All four share the same transaction shape: input 0 is the contract UTXO; input 1 (and optionally 2) are plain BCH "sponsor" inputs that pay the network fee, so that output 0 can carry the full value F; output 0 carries the contract's result; at most one extra output (change) is allowed.

CONSTRUCTOR ARGUMENTS AND REAL VALUES: the arguments are fixed when the pact is created and are part of each contract's redeem script. pkV, pkW are role keys (not payout addresses); lockV and lockW are the payout locking bytecodes (P2PKH) of the organizer and the worker; each contract also stores the locking bytecode of the next state. dustSafe = 1000 sat. dv = 432 blocks (about 3 days, relative lock for collect). l = 2016 blocks (about 14 days, dispute fallback). G = 1008 blocks (7 days), so tA4 = tEnd + G. tEnd and tA4 are absolute lock times and are block HEIGHTS (below 500,000,000), never timestamps. The arbiter fee fA is 2,000 sat; the fee F is at least 8,000 sat (the contract needs F >= 4*fA). The arbiter key pkA is a public key whose private key was generated once and not kept, so in practice every dispute ends on the D4 fallback. The app does not offer the dispute steps (C2, A4) yet; they exist in the contracts and in tests. An app outside this review builds the chain of four contracts from the pact terms; review the contracts themselves, and tell me which properties the contracts do NOT enforce and would have to be enforced by the software that builds the transactions.

INTENDED RULES (as I understand the design, check them against the code):
- Funded (F1 accept: worker signs; F2 cancel: organizer signs). Before accept, the organizer can take the whole fee back.
- Accepted: A1 pay (organizer signs, worker gets F), A2 waive (worker signs, organizer gets F back), A3 claim (worker signs, only when tx.time >= tEnd, moves to Requested), A4 open dispute (organizer signs, only when tx.time >= tA4, moves to Dispute with phi = 50).
- Requested: C1 complete (nobody signs, only when age >= dv, worker gets F), C2 object (organizer signs, moves to Dispute with phi = 100), C3 pay (organizer signs), C4 waive (worker signs).
- Dispute: D1 decide for worker, D2 decide for organizer, D3 split (all need the arbiter signature and pay the arbiter fee fA), D4 fallback (nobody signs, age >= l; phi = 100 pays the worker everything, phi = 50 splits the fee between worker and organizer), D5 organizer pays, D6 worker waives.
- Known and accepted limits (do not report these as new findings, but tell me if my description of them is wrong): no independent audit yet; D4 with phi = 100 pays the worker in full after an organizer objection when the arbiter does not act; keys live in the user's browser; a lost organizer key means funds at that stage cannot be taken back.

WHAT I WANT YOU TO CHECK, IN THIS ORDER:
1. Can anyone other than the intended signer move the UTXO, or move it to a different output than intended? Look at every function: signature checks, which outputs are pinned (lockingBytecode, value, tokenCategory), what is NOT pinned (extra outputs, output 1 and above, nSequence, locktime), and whether a sponsor or a miner could exploit that.
2. Value and fee logic: output 0 value == F with sponsor inputs paying the fee. Can the amount be dust-trapped, shaved, or made unspendable? Check integer division in D3 and D4 (w = F/2, v = F - w, net = F - fA), the dustSafe checks, and F values near the limits.
3. Time logic: tx.time >= tEnd and tx.time >= tA4 (CLTV), this.age >= dv and this.age >= l (CSV). Can a path be used too early, never become usable, or be blocked by the other party (for example by spending the UTXO through a different path first, or by tx version / sequence settings)? Does the order of states let the organizer or the worker race the other?
4. Token safety: all inputs and outputs are required to have tokenCategory == 0x. Is there any way a CashToken (NFT or fungible) can be attached, burned or used to break a path? Is the input count limit (2 or 3) and the output count limit correct in every function, including D1-D3 with 2, 3 and 4 outputs and D4 with phi = 50?
5. Fund-lock risks: can a state be reached from which no path is spendable? Can an organizer force the worker to lose the right to claim, or the reverse?
6. Phi handling in the Dispute contract: phi is a constructor constant (100 or 50) and the compiled contract is two instances of one source. Is there any way to mix the instances or pick the wrong behaviour?
7. Two direct questions: (a) if the organizer never does anything after the worker accepted, is the worker's money safe and collectable? (b) before the worker accepts, is the organizer's money safe and recoverable? Answer each with the exact sequence of transactions.
8. Anything else that looks wrong, unclear or dangerous, including comments that do not match the code.

OUTPUT FORMAT: first a table of findings sorted by severity (id, contract.function, one-line summary, severity, real bug / limitation / false alarm). Then one section per finding with the exact attack transaction. End with a short list of the things you checked and found correct, and a list of the questions you could not answer from the code alone.

=== GigPactFunded.cash ===
pragma cashscript ^0.14.0;

// GigPact R-0 - state 1 of 4: FUNDED (BCH mode).
// Paths: F1 accept (worker), F2 cancel (employer).
// Spec: Architecture v1.1 sections 2.1, 2.2, 9.2, 9.3. Every path needs a sponsor input.
contract GigPactFunded(
    pubkey pkV,          // employer role key (not the payout address)
    pubkey pkW,          // worker role key
    bytes lockV,         // employer payout locking bytecode
    bytes acceptedLock,  // locking bytecode of the next state (Accepted)
    int fundedValue,     // F_a: agreed fee, satoshis
    int fA,              // arbiter fee, satoshis
    int dustSafe         // DUST_SAFE, satoshis
) {
    // F1: worker accepts. Only an exactly funded UTXO passes. Output 0 = Accepted, value F.
    function accept(sig sigW) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;

        // 9.2 exact funding and 9.3 fixed-parameter limits (no multiplication)
        require(F == fundedValue);
        require(fA >= dustSafe);
        require(fA + fA + fA + fA <= fundedValue);
        require(fundedValue - fA >= dustSafe + dustSafe);
        require(fundedValue / 2 >= dustSafe);

        require(checkSig(sigW, pkW));

        require(tx.outputs[0].lockingBytecode == acceptedLock);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }

    // F2: employer takes the UTXO back, only while still Funded. Output 0 = lockV, value F.
    function cancel(sig sigV) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        // G1-01: no value floor on F2 in the contract. This is NOT a recovery guarantee:
        // a refund of a sub-DUST_SAFE UTXO also needs a sponsor input for the fee and
        // network relay policy to accept the output (measured in G7).

        require(checkSig(sigV, pkV));

        require(tx.outputs[0].lockingBytecode == lockV);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }
}

=== GigPactAccepted.cash ===
pragma cashscript ^0.14.0;

// GigPact R-0 - state 2 of 4: ACCEPTED (BCH mode).
// Paths: A1 pay (employer), A2 waive (worker), A3 claim (worker, time >= T_end),
//        A4 open dispute (employer, time >= T_A4 = T_end + G).
// Times only give a lower bound. Spec: Architecture v1.1 sections 2.2, 3.
contract GigPactAccepted(
    pubkey pkV,
    pubkey pkW,
    bytes lockV,
    bytes lockW,
    bytes requestedLock,       // next state after A3
    bytes disputeRefundLock,   // next state after A4 (Dispute with phi = 50)
    int tEnd,                  // T_end, absolute lock time
    int tA4,                   // T_A4 = T_end + G (G = 7 days), absolute lock time
    int dustSafe
) {
    // A1: employer pays the worker. Output 0 = lockW, value F.
    function pay(sig sigV) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(F >= dustSafe);
        require(checkSig(sigV, pkV));
        require(tx.outputs[0].lockingBytecode == lockW);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }

    // A2: worker waives, full refund. Output 0 = lockV, value F.
    function waive(sig sigW) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(F >= dustSafe);
        require(checkSig(sigW, pkW));
        require(tx.outputs[0].lockingBytecode == lockV);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }

    // A3: worker claims, not before T_end. Output 0 = Requested, value F.
    function claim(sig sigW) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(F >= dustSafe);
        require(tx.time >= tEnd);
        require(checkSig(sigW, pkW));
        require(tx.outputs[0].lockingBytecode == requestedLock);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }

    // A4: employer opens a dispute, not before T_A4. Output 0 = Dispute (phi = 50), value F.
    function openDispute(sig sigV) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(F >= dustSafe);
        require(tx.time >= tA4);
        require(checkSig(sigV, pkV));
        require(tx.outputs[0].lockingBytecode == disputeRefundLock);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }
}

=== GigPactRequested.cash ===
pragma cashscript ^0.14.0;

// GigPact R-0 - state 3 of 4: REQUESTED (BCH mode).
// Paths: C1 complete (anyone, age >= Dv), C2 object (employer), C3 pay (employer),
//        C4 waive (worker). C2..C4 have no upper time limit.
// Spec: Architecture v1.1 sections 2.2, 3.
contract GigPactRequested(
    pubkey pkV,
    pubkey pkW,
    bytes lockV,
    bytes lockW,
    bytes disputePayLock,   // next state after C2 (Dispute with phi = 100)
    int dv,                 // Dv in blocks (relative lock)
    int dustSafe
) {
    // C1: nobody signs; anyone may broadcast once the relative lock has passed. Output 0 = lockW, value F.
    function complete() {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(F >= dustSafe);
        require(this.age >= dv);
        require(tx.outputs[0].lockingBytecode == lockW);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }

    // C2: employer objects. Output 0 = Dispute (phi = 100), value F.
    function objectClaim(sig sigV) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(F >= dustSafe);
        require(checkSig(sigV, pkV));
        require(tx.outputs[0].lockingBytecode == disputePayLock);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }

    // C3: employer pays voluntarily. Output 0 = lockW, value F.
    function payOut(sig sigV) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(F >= dustSafe);
        require(checkSig(sigV, pkV));
        require(tx.outputs[0].lockingBytecode == lockW);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }

    // C4: worker waives, full refund. Output 0 = lockV, value F.
    function waive(sig sigW) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(F >= dustSafe);
        require(checkSig(sigW, pkW));
        require(tx.outputs[0].lockingBytecode == lockV);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }
}

=== GigPactDispute.cash ===
pragma cashscript ^0.14.0;

// GigPact R-0 - state 4 of 4: DISPUTE (BCH mode).
// One source, two instances: phi = 100 (after objection) and phi = 50 (after A4).
// Paths: D1 decide worker, D2 decide employer, D3 decide split (all arbiter),
//        D4 fallback (anyone, age >= L), D5 pay (employer), D6 waive (worker).
// phi is only 100 or 50, so there is no multiplication. Spec: Architecture v1.1 sections 2.2, 9.3.
contract GigPactDispute(
    pubkey pkV,
    pubkey pkW,
    pubkey pkA,
    bytes lockV,
    bytes lockW,
    bytes lockA,
    int phi,         // 100 or 50
    int fA,          // arbiter fee, satoshis (fixed parameter)
    int l,           // L in blocks (relative lock)
    int dustSafe
) {
    // D1: arbiter decides for the worker. Out 0 = lockW (F - fA), out 1 = lockA (fA).
    function decideWorker(sig sigA) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(fA >= dustSafe);
        require(F - fA >= dustSafe);
        require(checkSig(sigA, pkA));
        require(tx.outputs[0].lockingBytecode == lockW);
        require(tx.outputs[0].value == F - fA);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs[1].lockingBytecode == lockA);
        require(tx.outputs[1].value == fA);
        require(tx.outputs[1].tokenCategory == 0x);
        require(tx.outputs.length == 2 || tx.outputs.length == 3);
        if (tx.outputs.length == 3) {
            require(tx.outputs[2].tokenCategory == 0x);
        }
    }

    // D2: arbiter decides for the employer. Out 0 = lockV (F - fA), out 1 = lockA (fA).
    function decideEmployer(sig sigA) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(fA >= dustSafe);
        require(F - fA >= dustSafe);
        require(checkSig(sigA, pkA));
        require(tx.outputs[0].lockingBytecode == lockV);
        require(tx.outputs[0].value == F - fA);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs[1].lockingBytecode == lockA);
        require(tx.outputs[1].value == fA);
        require(tx.outputs[1].tokenCategory == 0x);
        require(tx.outputs.length == 2 || tx.outputs.length == 3);
        if (tx.outputs.length == 3) {
            require(tx.outputs[2].tokenCategory == 0x);
        }
    }

    // D3: arbiter splits. Out 0 = lockW floor((F-fA)/2), out 1 = lockV rest, out 2 = lockA (fA).
    function decideSplit(sig sigA) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        int net = F - fA;
        int w = net / 2;
        int v = net - w;
        require(fA >= dustSafe);
        require(w >= dustSafe);
        require(checkSig(sigA, pkA));
        require(tx.outputs[0].lockingBytecode == lockW);
        require(tx.outputs[0].value == w);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs[1].lockingBytecode == lockV);
        require(tx.outputs[1].value == v);
        require(tx.outputs[1].tokenCategory == 0x);
        require(tx.outputs[2].lockingBytecode == lockA);
        require(tx.outputs[2].value == fA);
        require(tx.outputs[2].tokenCategory == 0x);
        require(tx.outputs.length == 3 || tx.outputs.length == 4);
        if (tx.outputs.length == 4) {
            require(tx.outputs[3].tokenCategory == 0x);
        }
    }

    // D4: nobody signs; anyone may broadcast once age >= L.
    // phi = 100: out 0 = lockW (F). phi = 50: out 0 = lockW floor(F/2), out 1 = lockV rest.
    function fallback() {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(this.age >= l);
        require(phi == 100 || phi == 50);
        if (phi == 100) {
            require(F >= dustSafe);
            require(tx.outputs[0].lockingBytecode == lockW);
            require(tx.outputs[0].value == F);
            require(tx.outputs[0].tokenCategory == 0x);
            require(tx.outputs.length == 1 || tx.outputs.length == 2);
            if (tx.outputs.length == 2) {
                require(tx.outputs[1].tokenCategory == 0x);
            }
        } else {
            int w = F / 2;
            int v = F - w;
            require(w >= dustSafe);
            require(tx.outputs[0].lockingBytecode == lockW);
            require(tx.outputs[0].value == w);
            require(tx.outputs[0].tokenCategory == 0x);
            require(tx.outputs[1].lockingBytecode == lockV);
            require(tx.outputs[1].value == v);
            require(tx.outputs[1].tokenCategory == 0x);
            require(tx.outputs.length == 2 || tx.outputs.length == 3);
            if (tx.outputs.length == 3) {
                require(tx.outputs[2].tokenCategory == 0x);
            }
        }
    }

    // D5: employer pays the worker. Out 0 = lockW, value F.
    function payOut(sig sigV) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(F >= dustSafe);
        require(checkSig(sigV, pkV));
        require(tx.outputs[0].lockingBytecode == lockW);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }

    // D6: worker waives, full refund. Out 0 = lockV, value F.
    function waive(sig sigW) {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length >= 2);
        require(tx.inputs.length <= 3);
        require(tx.inputs[0].tokenCategory == 0x);
        require(tx.inputs[1].tokenCategory == 0x);
        if (tx.inputs.length == 3) {
            require(tx.inputs[2].tokenCategory == 0x);
        }
        int F = tx.inputs[this.activeInputIndex].value;
        require(F >= dustSafe);
        require(checkSig(sigW, pkW));
        require(tx.outputs[0].lockingBytecode == lockV);
        require(tx.outputs[0].value == F);
        require(tx.outputs[0].tokenCategory == 0x);
        require(tx.outputs.length == 1 || tx.outputs.length == 2);
        if (tx.outputs.length == 2) {
            require(tx.outputs[1].tokenCategory == 0x);
        }
    }
}

