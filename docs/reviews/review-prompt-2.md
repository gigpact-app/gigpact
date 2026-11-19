You are a senior security reviewer for Bitcoin Cash smart contracts (CashScript 0.14.0, libauth) and the JavaScript that builds and verifies their transactions. Review the files below as a skeptical adversary who wants to take money from, or lock money of, one of the two people using this product. Read the WHOLE file first. Do not search the web: work only from the code below and mark clearly anything you assume about CashScript, libauth or the network that is not visible in the files. A short, correct report with real findings is better than a long one with weak findings; if an area is fine, say so and say why.

PRODUCT: GigPact is a payment guarantee for live-event workers (musicians, sound and light crew) on Bitcoin Cash mainnet. The WORKER (role W) creates a request (title, fee F, event end as a block height, own payout address) and sends a link. The ORGANIZER (role V, "employer") opens the link, enters a refund address, and pays exactly F to the funding address, which is the address of contract 1 of 4. The contracts are four states of one coin: Funded -> Accepted -> Requested -> (Dispute). Each state stores the locking bytecode of the next state; the contracts do not check that those bytes are right. The browser app builds the whole chain from the pact terms, recomputes it, and compares it with what it expects (I12). Each role has one key per pact, generated in the browser and kept in localStorage. Wallet signatures for the network fee (a "sponsor" input) come from the user's own wallet over WizardConnect; the role signature is made in the browser. Every spend has input 0 = the contract coin, input 1 (and optionally 2) = plain sponsor coins that pay the fee, output 0 = the contract result for the full value F, and at most one change output.

PATHS: F1 accept (W signs), F2 cancel (V signs); A1 pay (V), A2 waive (W), A3 claim (W, only when tx.time >= tEnd, moves to Requested), A4 open dispute (V, only when tx.time >= tA4 = tEnd + 1008 blocks, moves to Dispute phi = 50); C1 collect (nobody signs, relative lock 432 blocks, pays the worker), C2 object (V, moves to Dispute phi = 100), C3 pay (V), C4 waive (W); D1/D2/D3 arbiter decides (the arbiter key is a public key whose private key was generated once and not kept), D4 fallback (nobody signs, relative lock 2016 blocks: phi = 100 pays the worker everything, phi = 50 splits), D5 pay (V), D6 waive (W). The app does not offer C2, A4 or the dispute steps; they exist in the contracts and tests. Real values: dustSafe 1000 sat, arbiter fee fA 2000 sat, F at least 8000 sat (the form asks for at least 10000), tEnd and tA4 are block heights.

ALREADY KNOWN (do not report these again unless you can show they are worse than described, or that the app does not handle them): (1) the contracts do not check the next-state bytecode, keys, payout locks or time constants: the app must; (2) after tA4 the organizer can open a 50/50 dispute before the worker claims; (3) the organizer can object just before the collect, delaying the worker by the 2016-block fallback; (4) a funding output with a CashToken is unspendable; (5) a sub-dust cancel can be refused by relay; (6) the odd satoshi of a split goes to the organizer; (7) if both role keys are lost during Funded or Accepted the coin is frozen; (8) the demo arbiter key could in theory still exist; (9) no human audit exists.

WHAT I WANT, IN THIS ORDER:
A. THREAT ACTORS. For each actor, list the best attack you can find and the exact steps (what they send, sign, broadcast or change in a link) and what the victim sees in the app: (1) a malicious organizer who controls the funding step and the link; (2) a malicious worker; (3) someone who changes a link in transit (message app, email) between the two people: which fields can be changed and what does the app check; (4) a faulty or malicious chain data provider (the app reads UTXOs, heights and confirmations from remote servers, with a failover): what can it hide, fake, replay or delay, and can that make the app sign or broadcast something harmful; (5) a wallet that answers a signing request with a different transaction than the one requested; (6) a malicious web page or another tab on the same site reading or replacing the keys in localStorage; (7) a user who enters unusual input (event end in the past or far in the future, tiny or huge fee, odd address types, very long or special-character titles, a pasted pact link from another network or version).
B. TRANSACTION LIBRARY. Read the spend planner and builder, the wizard verification and the chain code. Check: does verifySigned (or its equivalent) really make a transaction with changed outputs, changed sequence or locktime, a wrong sighash type, a duplicated input or an extra output impossible to accept? Are there integer, bigint or number mix-ups, rounding errors, fee-rate or dust edge cases, change-output errors, sponsor-selection errors, or places where a thrown error leaves the app in a state where it believes something is funded, accepted or finished when it is not (or the reverse)? Is the 1-confirmation gate and any "fail open" behavior safe?
C. CROSS-LAYER. List every property the contracts do NOT enforce and say, for each, which line of the JavaScript enforces it, or that nothing does. This list is the most valuable part of your answer.
D. DIRECT QUESTIONS, each answered with the exact sequence of transactions: (a) if the organizer never does anything after the worker accepted, can the worker always collect the full F, and what must the worker's software and wallet do? (b) before the worker accepts, can the organizer always get the full F back? (c) can any single party, with only its own role key, ever take the whole F in a way the other party did not agree to, outside the known limits above? (d) can a sponsor, miner or relay node change the outcome?
E. For every finding of severity medium or higher, add a minimal reproduction idea: a short JavaScript or pseudo-code test that would fail on the current code.
F. Anything that looks wrong, misleading or inconsistent, including comments or error messages that promise more than the code does.

OUTPUT FORMAT: a table of findings sorted by severity (id, file and function, one-line summary, severity critical / high / medium / low / info, real bug / limitation / false alarm, confidence high / medium / low). Then one section per finding with the exact attack steps, who loses what, and the evidence (file and function). Then section C as a table (property, enforced by contract / enforced by JavaScript at where / not enforced), then section D. End with what you checked and found correct, and the questions you could not answer from the code alone.

FILES (each starts with a line "=== path ==="):

=== contracts/GigPactFunded.cash ===
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


=== contracts/GigPactAccepted.cash ===
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


=== contracts/GigPactRequested.cash ===
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


=== contracts/GigPactDispute.cash ===
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


=== src/chain.mjs ===
// GigPact transaction library, part 1: job parameters and the contract chain (I12).
// Builds Dispute -> Requested -> Accepted -> Funded bottom-up, because each state embeds the locking
// bytecode of the next one. The contracts do NOT cross-check these parameters (G1-03); this module
// is where I12 is enforced and verified.
import { Contract, SignatureTemplate } from 'cashscript';
import { cashAddressToLockingBytecode, binToHex, secp256k1 } from '@bitauth/libauth';
import { strictBytes } from './errors.mjs';
// JSON imports (not fs) so the same library runs in Node and in the browser bundle; the files are the frozen compiled artifacts.
import Funded from '../artifacts/GigPactFunded.json' with { type: 'json' };
import Accepted from '../artifacts/GigPactAccepted.json' with { type: 'json' };
import Requested from '../artifacts/GigPactRequested.json' with { type: 'json' };
import Dispute from '../artifacts/GigPactDispute.json' with { type: 'json' };

export const BIP68_MAX_BLOCKS = 0xffffn; // largest block-based relative lock (low 16 bits of nSequence)
export const DEFAULTS = Object.freeze({ dv: 432n, l: 2016n, G: 1008n, dust: 1000n }); // blocks; G = 7 days
const ART_JSON = { GigPactFunded: Funded, GigPactAccepted: Accepted, GigPactRequested: Requested, GigPactDispute: Dispute };
const ART = Object.keys(ART_JSON);
const art = (n) => structuredClone(ART_JSON[n]); // a fresh copy per use, as readFileSync+JSON.parse gave before
export const artifacts = () => Object.fromEntries(ART.map((n) => [n, art(n)]));

const hex = (b) => (typeof b === 'string' ? b : binToHex(b));
const bytes = (b) => { try { return strictBytes(b); } catch (e) { throw new ParamError(e.message); } };
export class ParamError extends Error { constructor(m) { super(m); this.name = 'ParamError'; } }
const need = (c, m) => { if (!c) throw new ParamError(m); };

// params: { pk:{V,W,A}, lock:{V,W,A}, F, fA, tEnd, dv?, l?, G?, dust? }  (pubkeys/locks: Uint8Array or hex)
export function normalize(p) {
  // only the known fields are kept: an unknown field in a parameter set is never carried along (and is caught by assertChain)
  const n = { dv: DEFAULTS.dv, l: DEFAULTS.l, G: DEFAULTS.G, dust: DEFAULTS.dust, F: p.F, fA: p.fA, tEnd: p.tEnd };
  for (const k of ['dv', 'l', 'G', 'dust']) if (p[k] !== undefined) n[k] = p[k];
  n.pk = {}; n.lock = {};
  for (const r of ['V', 'W', 'A']) {
    n.pk[r] = Uint8Array.from(bytes(p.pk?.[r] ?? '')); n.lock[r] = Uint8Array.from(bytes(p.lock?.[r] ?? '')); // copies: never alias caller memory
    need(n.pk[r].length === 33 && (n.pk[r][0] === 2 || n.pk[r][0] === 3), `pk${r} must be a 33-byte compressed public key`);
    need(secp256k1.validatePublicKey(n.pk[r]), `pk${r} is not a valid secp256k1 point`);
    need(n.lock[r].length > 0 && n.lock[r].length <= 100, `lock${r} must be a locking bytecode (1..100 bytes)`);
  }
  for (const k of ['F', 'fA', 'tEnd', 'dv', 'l', 'G', 'dust']) need(typeof n[k] === 'bigint' && n[k] > 0n, `${k} must be a positive bigint`);
  // BIP68 relative locks are block-based here: value in the low 16 bits only; disable flag (1<<31) and time-type flag (1<<22) stay clear
  for (const k of ['dv', 'l']) need(n[k] <= BIP68_MAX_BLOCKS, `${k} must be 1..${BIP68_MAX_BLOCKS} blocks (BIP68 16-bit relative lock, block-based)`);
  need(n.tEnd < 500_000_000n, 'tEnd must be a block height (< 500,000,000); unix-time locks are not used');
  need(n.tEnd + n.G < 500_000_000n, 'T_A4 must stay a block height');
  // K12 / 9.2 / 9.3 constraints (also enforced by Funded.accept; checked early so the UI never builds a dead job)
  need(n.fA >= n.dust, 'fA must be >= DUST_SAFE');
  need(4n * n.fA <= n.F, 'fA must be <= F/4 (K12)');
  need(n.F - n.fA >= 2n * n.dust, 'F - fA must be >= 2*DUST_SAFE');
  need(n.F / 2n >= n.dust, 'F/2 must be >= DUST_SAFE');
  n.tA4 = n.tEnd + n.G; // Alt-2: A4 only after T_end + G
  return n;
}

const lockOf = (c) => cashAddressToLockingBytecode(c.address).bytecode;

export function buildChain(params, { provider } = {}) {
  need(provider, 'provider required');
  const p = normalize(params);
  const a = artifacts();
  const mk = (name, args) => new Contract(a[name], args, { provider });
  const pk = [p.pk.V, p.pk.W];
  const dispute = (phi) => mk('GigPactDispute', [...pk, p.pk.A, p.lock.V, p.lock.W, p.lock.A, BigInt(phi), p.fA, p.l, p.dust]);
  const d100 = dispute(100), d50 = dispute(50);
  const requested = mk('GigPactRequested', [...pk, p.lock.V, p.lock.W, lockOf(d100), p.dv, p.dust]);
  const accepted = mk('GigPactAccepted', [...pk, p.lock.V, p.lock.W, lockOf(requested), lockOf(d50), p.tEnd, p.tA4, p.dust]);
  const funded = mk('GigPactFunded', [p.pk.V, p.pk.W, p.lock.V, lockOf(accepted), p.F, p.fA, p.dust]);
  const contracts = { funded, accepted, requested, d100, d50 };
  const locks = { V: p.lock.V, W: p.lock.W, A: p.lock.A, ...Object.fromEntries(Object.entries(contracts).map(([k, c]) => [k, lockOf(c)])) };
  return { params: p, contracts, locks, addresses: Object.fromEntries(Object.entries(contracts).map(([k, c]) => [k, c.address])) };
}

// I12: recompute the whole chain from the job parameters and compare with what was claimed
// (a job link, a stored record, or contracts built elsewhere). P2SH32 addresses commit to the full
// redeem bytecode, so address equality means every embedded parameter matches.
export function verifyChain(params, claimedAddresses, { provider }) {
  const expected = buildChain(params, { provider }).addresses;
  const mismatches = Object.keys(expected).filter((k) => claimedAddresses?.[k] !== expected[k]);
  return { ok: mismatches.length === 0, mismatches, expected };
}

// A chain object must be self-consistent AND everything the planner uses must come from a fresh rebuild:
// parameters (including the derived tA4), the five contract addresses, every lock (V/W/A and the five contract
// locks) and the contract objects themselves. Nothing is memoised: a chain object is mutable, so a one-time check
// would not protect later spends. Returns the freshly rebuilt chain; callers must use THAT object, not the claimed one.
export function assertChain(chain) {
  if (!chain?.params || !chain.addresses || !chain.locks || !chain.contracts?.funded?.provider) throw new ParamError('chain object is incomplete');
  const fresh = buildChain(chain.params, { provider: chain.contracts.funded.provider });
  if (canonParams(chain.params) !== canonParams(fresh.params)) throw new ParamError('chain parameters differ from the normalized parameters (I12)');
  const bad = [];
  for (const k of Object.keys(fresh.addresses)) {
    if (chain.addresses[k] !== fresh.addresses[k]) bad.push(`address.${k}`);
    if (chain.contracts[k]?.address !== fresh.addresses[k]) bad.push(`contract.${k}`);
  }
  for (const k of Object.keys(fresh.locks)) if (!chain.locks[k] || canonParams(bytes(chain.locks[k])) !== canonParams(fresh.locks[k])) bad.push(`lock.${k}`);
  if (Object.keys(chain.locks).length !== Object.keys(fresh.locks).length || Object.keys(chain.addresses).length !== Object.keys(fresh.addresses).length) bad.push('extra keys');
  if (bad.length) throw new ParamError(`chain inconsistent with its parameters (I12): ${bad.join(',')}`);
  return fresh;
}

// Canonical text of a parameter set (bigint / bytes safe), for exact comparison of two jobs or chains.
export function canonParams(p) {
  // type-tagged and key-sorted, so different shapes can never print the same text
  const norm = (v) => (typeof v === 'bigint' ? ['b', v.toString()] : v instanceof Uint8Array ? ['x', binToHex(v)] : Array.isArray(v) ? ['a', ...v.map(norm)]
    : v && typeof v === 'object' ? ['o', ...Object.keys(v).sort().map((k) => [k, norm(v[k])])] : ['p', typeof v, String(v)]);
  return JSON.stringify(norm(p));
}

// Deep copy of normalized parameters (bytes and bigint safe) so a stored job cannot be changed through a shared object.
export function cloneParams(p) {
  const f = (v) => (v instanceof Uint8Array ? Uint8Array.from(v) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, f(x)])) : v);
  return f(p);
}

export const keyTemplate = (key, sighash) => new SignatureTemplate(key, sighash);
export { lockOf, hex, bytes };


=== src/spend.mjs ===
// GigPact transaction library, part 2: spend plans for the 16 paths.
// A "plan" is plain data (inputs, outputs, locktime, sequences) that can be reviewed and tested
// without signing; toBuilder() turns it into a CashScript TransactionBuilder for dry-run or local signing.
import { TransactionBuilder, SighashType, randomUtxo } from 'cashscript';
import { binToHex, hexToBin, decodeTransactionBch, encodeTransactionBch } from '@bitauth/libauth';
import { assertChain } from './chain.mjs';
import { SpendError, checkOutpoint, strictBytes } from './errors.mjs';
import { assertF1Funding } from './k17.mjs';

export const SEQ_NONFINAL = 0xfffffffe;      // sponsor inputs and non-CSV contract inputs (G6: no relative lock, CLTV needs non-final)
export const SIGHASH_61 = SighashType.SIGHASH_ALL | SighashType.SIGHASH_UTXOS; // on wire 0x61
export const MIN_OUTPUT = 546n;               // SDK/network floor for the sponsor change output (G7 measures real policy)
export const MAX_FEE_RATE = 2;                // sat/byte, doc 1.3 suggestion (library policy, not a contract rule)
const FEE_SLACK = 2n;                         // cap = size*MAX_FEE_RATE + FEE_SLACK. The fitted fee is ceil(size*rate) + MARGIN(2), so at rate 2 the real rate is about 2.002 sat/byte; this 2-sat allowance is deliberate and pinned in the tests
export const BIP68_DISABLE = 0x80000000, BIP68_TYPE = 0x400000, BIP68_VALUE_MASK = 0xffff;

// nSequence for a block-based BIP68 relative lock of n blocks: only the low 16 bits, disable flag and time-type flag clear.
export function csvSequence(n) {
  need(typeof n === 'bigint' && n >= 1n && n <= 0xffffn, 'BadCsvSequence', `relative lock must be 1..65535 blocks, got ${n}`);
  const seq = Number(n);
  need((seq & BIP68_DISABLE) === 0 && (seq & BIP68_TYPE) === 0 && (seq & ~BIP68_VALUE_MASK) === 0 && seq === Number(n), 'BadCsvSequence', 'sequence must be block-based with no flag bits');
  return seq;
}

const bytesOf = strictBytes;
// smallest change output the SDK/network accepts for a lock of this length: 3 * (8 + 1 + len + 148) sat, never below MIN_OUTPUT
// (P2PKH 546, P2SH32 576). Real relay policy is measured later (G7).
export const changeFloor = (lock) => { const f = BigInt(3 * (157 + bytesOf(lock).length)); return f > MIN_OUTPUT ? f : MIN_OUTPUT; };
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
export { SpendError };
const need = (c, code, m) => { if (!c) throw new SpendError(code, m); };

// id -> contract key, function, signer, time rule, outputs given F
export const PATHS = {
  F1: { c: 'funded', fn: 'accept', signer: 'W', outs: (L, F) => [[L.accepted, F]] },
  F2: { c: 'funded', fn: 'cancel', signer: 'V', outs: (L, F) => [[L.V, F]] },
  A1: { c: 'accepted', fn: 'pay', signer: 'V', outs: (L, F) => [[L.W, F]] },
  A2: { c: 'accepted', fn: 'waive', signer: 'W', outs: (L, F) => [[L.V, F]] },
  A3: { c: 'accepted', fn: 'claim', signer: 'W', outs: (L, F) => [[L.requested, F]], cltv: 'tEnd' },
  A4: { c: 'accepted', fn: 'openDispute', signer: 'V', outs: (L, F) => [[L.d50, F]], cltv: 'tA4' },
  C1: { c: 'requested', fn: 'complete', signer: null, outs: (L, F) => [[L.W, F]], csv: 'dv' },
  C2: { c: 'requested', fn: 'objectClaim', signer: 'V', outs: (L, F) => [[L.d100, F]] },
  C3: { c: 'requested', fn: 'payOut', signer: 'V', outs: (L, F) => [[L.W, F]] },
  C4: { c: 'requested', fn: 'waive', signer: 'W', outs: (L, F) => [[L.V, F]] },
  D1: { c: 'd100', fn: 'decideWorker', signer: 'A', outs: (L, F, p) => [[L.W, F - p.fA], [L.A, p.fA]] },
  D2: { c: 'd100', fn: 'decideEmployer', signer: 'A', outs: (L, F, p) => [[L.V, F - p.fA], [L.A, p.fA]] },
  D3: { c: 'd100', fn: 'decideSplit', signer: 'A', outs: (L, F, p) => { const w = (F - p.fA) / 2n; return [[L.W, w], [L.V, F - p.fA - w], [L.A, p.fA]]; } },
  D4: { c: 'd100|d50', fn: 'fallback', signer: null, csv: 'l', outs: (L, F, p, phi) => (phi === 100 ? [[L.W, F]] : [[L.W, F / 2n], [L.V, F - F / 2n]]) },
  D5: { c: 'd100|d50', fn: 'payOut', signer: 'V', outs: (L, F) => [[L.W, F]] },
  D6: { c: 'd100|d50', fn: 'waive', signer: 'W', outs: (L, F) => [[L.V, F]] },
};
export const PATH_IDS = Object.keys(PATHS);

// ctx: { phi?:100|50 (dispute instance), tipHeight?, confirmations?, dryRun? }
// One-time copy of a caller-supplied UTXO: every property is read exactly once and the lock is copied to bytes, so
// nothing validated below can change between validation and use (getters, shared arrays, hex vs bytes).
function snap(u) {
  if (!u || typeof u !== 'object') return u;
  const c = { ...u };
  if (c.lockingBytecode !== undefined && c.lockingBytecode !== null) c.lockingBytecode = Uint8Array.from(bytesOf(c.lockingBytecode));
  return c;
}
// standard spendable shapes only: P2PKH (25 bytes), P2SH20 (23), P2SH32 (35)
const isStandardLock = (l) => (l.length === 25 && l[0] === 0x76 && l[1] === 0xa9 && l[2] === 0x14 && l[23] === 0x88 && l[24] === 0xac)
  || (l.length === 23 && l[0] === 0xa9 && l[1] === 0x14 && l[22] === 0x87)
  || (l.length === 35 && l[0] === 0xaa && l[1] === 0x20 && l[34] === 0x87);
const isCount = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0) || (typeof v === 'bigint' && v >= 0n);
const freezeAll = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) freezeAll(v); return Object.freeze(o); };

// utxo: { txid, vout, satoshis }   sponsors: [{ txid, vout, satoshis, lockingBytecode, token? }]
export function planSpend({ chain: claimed, path, utxo: utxoIn, sponsors: sponsorsIn, feeRate = 1, ctx: ctxIn, job }) {
  const P = Object.hasOwn(PATHS, path) ? PATHS[path] : undefined; need(P, 'UnknownPath', String(path));
  need(ctxIn === undefined || (ctxIn !== null && typeof ctxIn === 'object' && !Array.isArray(ctxIn)), 'BadContext', 'ctx must be a plain object');
  const utxo = snap(utxoIn), ctx = { ...(ctxIn ?? {}) };
  const sponsors = Array.isArray(sponsorsIn) ? Array.from(sponsorsIn, snap) : sponsorsIn; // Array.from: a hostile Symbol.species / own map cannot interfere
  for (const k of ['tipHeight', 'confirmations']) need(ctx[k] === undefined || isCount(ctx[k]), 'BadContext', `${k} must be a non-negative integer`);
  // Everything below (parameters, locks, contracts, tA4) comes from a FRESH verified rebuild of the claimed chain (I12).
  const chain = assertChain(claimed);
  const p = chain.params, L = chain.locks;
  const phi = ctx.phi ?? 100;
  need(phi === 100 || phi === 50, 'BadPhi', 'phi must be 100 or 50');
  const ck = P.c.includes('|') ? (phi === 100 ? 'd100' : 'd50') : P.c;
  const contract = chain.contracts[ck];
  need(utxo && typeof utxo.satoshis === 'bigint', 'BadUtxo', 'contract UTXO required');
  checkOutpoint(utxo, 'contract UTXO');
  // the supplied UTXO must really sit at the expected contract lock, and carry no CashTokens/NFTs (BCH-only boundary)
  need(utxo.lockingBytecode !== undefined && utxo.lockingBytecode !== null, 'UtxoLockMissing', 'contract UTXO must include its actual lockingBytecode');
  need(sameBytes(bytesOf(utxo.lockingBytecode), L[ck]), 'UtxoLockMismatch', `UTXO is not locked by the ${ck} contract of this chain`);
  need(!utxo.token, 'ContractUtxoToken', 'contract UTXO must carry no token or NFT (BCH-only)');
  need(Array.isArray(sponsors) && sponsors.length >= 1 && sponsors.length <= 2, 'SponsorCount', 'R-0 needs 1 or 2 sponsor inputs (2..3 inputs in total)');
  const contractLocks = ['funded', 'accepted', 'requested', 'd100', 'd50'].map((k) => L[k]);
  const seenOutpoints = new Set([`${utxo.txid.toLowerCase()}:${utxo.vout}`]);
  for (const s of sponsors) {
    need(s && !s.token, 'SponsorToken', 'sponsor inputs must carry no token or NFT (tokenCategory == 0x)');
    checkOutpoint(s, 'sponsor');
    need(typeof s.satoshis === 'bigint' && s.satoshis > 0n, 'BadSponsor', 'sponsor satoshis must be a positive bigint');
    need(s.lockingBytecode !== undefined && s.lockingBytecode !== null && bytesOf(s.lockingBytecode).length > 0, 'BadSponsor', 'sponsor needs its lockingBytecode');
    need(!contractLocks.some((cl) => sameBytes(cl, bytesOf(s.lockingBytecode))), 'SponsorIsContract', 'a sponsor input must not sit at a GigPact contract lock');
    const key = `${s.txid.toLowerCase()}:${s.vout}`;
    need(!seenOutpoints.has(key), 'SponsorDuplicate', 'sponsor outpoints must be distinct from each other and from the contract UTXO');
    seenOutpoints.add(key);
  }
  need(typeof feeRate === 'number' && feeRate >= 1 && feeRate <= MAX_FEE_RATE, 'FeeRate', `fee rate must be in [1, ${MAX_FEE_RATE}] sat/byte`);
  if (path === 'F1') { need(job, 'K17NotDeclared', 'F1 needs the job record (K17)'); assertF1Funding(job, utxo, chain); }
  const F = utxo.satoshis;
  const outs = P.outs(L, F, p, phi).map(([lock, amount]) => ({ lock, amount }));
  // F2 is the escape hatch (G1-01): the contract takes any amount, so the library only enforces the SDK/network floor there.
  const floor = path === 'F2' ? MIN_OUTPUT : p.dust;
  for (const o of outs) need(o.amount >= floor, 'DustOutput', `output ${o.amount} below ${path === 'F2' ? 'output floor' : 'DUST_SAFE'} ${floor}`);
  need(outs.reduce((s, o) => s + o.amount, 0n) === F, 'Conservation', 'contract outputs must sum to the contract input exactly');
  // timing: the library refuses to build a transaction the node would not accept yet (R-VM cannot see this; G3 observes it)
  let locktime = 0, seq0 = SEQ_NONFINAL;
  if (P.cltv) {
    const T = p[P.cltv]; locktime = Number(T);
    if (ctx.dryRun !== true) { need(ctx.tipHeight !== undefined, 'MissingContext', 'tipHeight required'); need(BigInt(ctx.tipHeight) >= T, 'TooEarly', `${path} needs chain height >= ${T}`); }
  }
  if (P.csv) {
    const N = p[P.csv]; seq0 = csvSequence(N);
    if (ctx.dryRun !== true) { need(ctx.confirmations !== undefined, 'MissingContext', 'confirmations required'); need(BigInt(ctx.confirmations) >= N, 'TooEarly', `${path} needs the UTXO to have >= ${N} confirmations`); }
  }
  const planOuts = outs.map((o) => ({ lock: Uint8Array.from(o.lock), amount: o.amount }));
  const plan = { path, contractLocks: contractLocks.map((l) => Uint8Array.from(l)), contractKey: ck, contract, fn: P.fn, signer: P.signer, input0: { ...utxo, sequence: seq0 }, sponsors: sponsors.map((s) => ({ ...s, sequence: SEQ_NONFINAL })), outs: planOuts, locktime, feeRate, phi: P.c.includes('|') ? phi : 100 };
  // the contract object is a live SDK object and typed arrays (locks) cannot be frozen; the plain-data fields are frozen and every lock is a private copy
  Object.freeze(plan.input0); plan.sponsors.forEach(Object.freeze); Object.freeze(plan.sponsors); planOuts.forEach(Object.freeze); Object.freeze(planOuts); Object.freeze(plan.contractLocks);
  return Object.freeze(plan);
}

// Turn a plan into a CashScript builder. keys: { V, W, A } role keys and S sponsor key (local signer / dry-run only).
// sponsorUnlock (optional, WizardConnect): s => unlocker for a sponsor input, used when a wallet signs it instead of keys.S.
export function toBuilder(plan, { provider, keys, SignatureTemplate, changeLock, fee, sponsorUnlock }) {
  const sigArgs = plan.signer ? [new SignatureTemplate(keys[plan.signer], SIGHASH_61)] : [];
  const b = new TransactionBuilder({ provider, maximumFeeSatoshis: 1_000_000n });
  const c0 = { txid: plan.input0.txid, vout: plan.input0.vout, satoshis: plan.input0.satoshis, lockingBytecode: binToHex(plan.input0.lockingBytecode) };
  b.addInput(c0, plan.contract.unlock[plan.fn](...sigArgs), { sequence: plan.input0.sequence });
  let S = 0n;
  for (const s of plan.sponsors) { b.addInput({ txid: s.txid, vout: s.vout, satoshis: s.satoshis, lockingBytecode: binToHex(s.lockingBytecode) }, sponsorUnlock ? sponsorUnlock(s) : new SignatureTemplate(keys.S, SIGHASH_61).unlockP2PKH(), { sequence: s.sequence }); S += s.satoshis; }
  for (const o of plan.outs) b.addOutput({ to: o.lock, amount: o.amount });
  const change = S - fee;
  if (change >= changeFloor(changeLock)) b.addOutput({ to: changeLock, amount: change });
  if (plan.locktime) b.setLocktime(plan.locktime);
  return b;
}

// Account for the transaction as actually serialized and compare it with the plan: version, input order and
// outpoints, sequences, locktime, every contract output (lock and amount), the change output, real fee and change.
// Throws if anything the plan promised is not in the bytes. changeLock is mandatory whenever a change output exists.
export function inspectTx(plan, hex, changeLock) {
  const tx = decodeTransactionBch(hexToBin(hex));
  need(typeof tx !== 'string', 'BadTx', String(tx));
  need(tx.version >= 2, 'TxVersion', `transaction version ${tx.version} < 2 (BIP68 relative locks are not enforced below version 2)`);
  const S = plan.sponsors.reduce((a, s) => a + s.satoshis, 0n);
  const totalIn = plan.input0.satoshis + S;
  const n = plan.outs.length;
  const ins = [plan.input0, ...plan.sponsors];
  need(tx.inputs.length === ins.length, 'PlanMismatch', 'input count differs from the plan');
  ins.forEach((u, i) => {
    need(binToHex(tx.inputs[i].outpointTransactionHash) === u.txid.toLowerCase() && tx.inputs[i].outpointIndex === u.vout, 'PlanMismatch', `input ${i} outpoint differs from the plan`);
    need(tx.inputs[i].sequenceNumber === u.sequence, 'PlanMismatch', `input ${i} nSequence differs from the plan`);
  });
  need(tx.locktime === plan.locktime, 'PlanMismatch', 'locktime differs from the plan');
  need(tx.outputs.length === n || tx.outputs.length === n + 1, 'BadTx', 'unexpected output count');
  plan.outs.forEach((o, i) => {
    need(tx.outputs[i].valueSatoshis === o.amount && sameBytes(tx.outputs[i].lockingBytecode, bytesOf(o.lock)), 'PlanMismatch', `contract output ${i} differs from the plan`);
    need(!tx.outputs[i].token, 'PlanMismatch', `contract output ${i} carries a token`);
  });
  const outSum = tx.outputs.reduce((a, o) => a + o.valueSatoshis, 0n);
  const contractOut = tx.outputs.slice(0, n).reduce((a, o) => a + o.valueSatoshis, 0n);
  need(contractOut === plan.input0.satoshis, 'Conservation', 'serialized contract outputs differ from the contract input value');
  const hasChange = tx.outputs.length === n + 1;
  const change = hasChange ? tx.outputs[n].valueSatoshis : 0n;
  if (hasChange) {
    need(changeLock, 'NoChangeLock', 'changeLock is required to inspect a transaction that has a change output');
    need(change >= changeFloor(changeLock), 'BadTx', 'change output below the output floor');
    need(!tx.outputs[n].token, 'PlanMismatch', 'change output carries a token');
    need(changeLock, 'NoChangeLock', 'changeLock is required to inspect a transaction that has a change output');
    need(sameBytes(tx.outputs[n].lockingBytecode, bytesOf(changeLock)), 'PlanMismatch', 'change output lock differs from changeLock');
  }
  const fee = totalIn - outSum;
  need(fee === S - change && fee >= 0n, 'Accounting', 'fee must equal the sponsor total minus change');
  return { version: tx.version, locktime: tx.locktime, fee, change, hasChange, size: hex.length / 2, totalIn, outSum, sequences: tx.inputs.map((i) => i.sequenceNumber) };
}

// Build with a fee that matches the real size at feeRate. Two shapes exist and both sizes are fixed (Schnorr
// signatures and 8-byte amounts are fixed width), so no iteration is needed: the with-change shape is used whenever the
// fitted fee leaves at least MIN_OUTPUT of change; otherwise the change output is dropped and the WHOLE sponsor
// remainder becomes the fee, which must still pass the fee-rate cap. Returned fee/change are read back from the bytes.
export function buildTx(plan, optsIn) {
  need(optsIn.changeLock, 'NoChangeLock', 'sponsor change lock required');
  const changeLock = Uint8Array.from(bytesOf(optsIn.changeLock)); // hex or bytes in, bytes used everywhere below
  need(isStandardLock(changeLock), 'BadChangeLock', 'change lock must be a standard P2PKH, P2SH20 or P2SH32 locking bytecode');
  const opts = { ...optsIn, changeLock };
  need(!plan.contractLocks.some((l) => sameBytes(l, changeLock)), 'ChangeToContract', 'change must not be sent to a GigPact contract lock');
  need(typeof plan.feeRate === 'number' && plan.feeRate >= 1 && plan.feeRate <= MAX_FEE_RATE, 'FeeRate', `fee rate must be in [1, ${MAX_FEE_RATE}] sat/byte`);
  const S = plan.sponsors.reduce((a, s) => a + s.satoshis, 0n);
  // The 2-sat MARGIN is part of the fee target, so a remainder within MARGIN of MIN_OUTPUT is treated as 'no change'
  // (the change output is dropped, not shrunk). This shifts the 546 boundary by 2 sat and is pinned in the tests.
  const MARGIN = 2n;
  const sizeOf = (fee) => encodeTransactionBch(toBuilder(plan, { ...opts, fee }).buildLibauthTransaction(true)).length;
  const need_ = (size) => BigInt(Math.ceil(size * plan.feeRate)) + MARGIN;
  let fee;
  const floor = changeFloor(changeLock);
  const feeC = S > floor ? need_(sizeOf(S - floor)) : undefined; // fee for the with-change shape
  if (feeC !== undefined && S - feeC >= floor) fee = feeC;
  else {
    const feeN = need_(sizeOf(S)); // no change output: fee == S
    need(feeN <= S, 'InsufficientSponsor', `sponsor inputs (${S} sat) cannot pay the ${feeN} sat fee`);
    fee = S;
  }
  const b = toBuilder(plan, { ...opts, fee });
  let hex;
  try { hex = b.build(); } catch (e) {
    if (/FeePerByteTooLow/i.test(String(e?.name)) || /lower than the standard minimum fee/.test(String(e?.message))) throw new SpendError('InsufficientSponsor', `sponsor inputs (${S} sat) cannot pay the minimum fee`);
    throw e;
  }
  const a = inspectTx(plan, hex, changeLock);
  need(a.fee >= BigInt(a.size), 'FeeTooLow', `actual fee ${a.fee} sat is below the 1 sat/byte relay minimum for ${a.size} bytes`);
  need(a.fee <= BigInt(a.size) * BigInt(MAX_FEE_RATE) + FEE_SLACK, 'FeeTooHigh', `actual fee ${a.fee} sat on ${a.size} bytes exceeds ${MAX_FEE_RATE} sat/byte${a.hasChange ? '' : ' (change below ' + MIN_OUTPUT + ' sat was dropped into the fee)'}`);
  return { builder: b, hex, fee: a.fee, size: a.size, change: a.change, hasChange: a.hasChange, version: a.version };
}
export { randomUtxo };


=== src/wizard.mjs ===
// GigPact WizardConnect module: builds the sign request and checks what the wallet sends back.
//
// Design (Yol B, matches the WizardConnect docs read on 16 Nov 2026):
//   * The contract input is signed HERE with the role key (V / W / A) that lives in the browser. Its unlocking
//     bytecode is complete, so it needs no inputPaths entry (the wallet leaves inputs without an entry alone).
//   * The only input the wallet signs is the sponsor P2PKH input (fee + change). Its unlocking bytecode is empty in
//     the request; inputPaths is sparse: [[inputIndex, pathName, addressIndex], ...] for the sponsor inputs only.
//   * The role signature uses SIGHASH_ALL|FORKID|UTXOS (0x61). That preimage commits to outpoints, sequences,
//     outputs and every source output, but NOT to unlocking scripts, so filling in the sponsor script afterwards
//     does not invalidate it. Wallets MUST sign with 0x61 and reject other flags (WizardConnect rule).
//   * The wallet is not trusted: verifySigned() re-derives the transaction we asked for, and refuses anything that
//     differs by even one byte outside the sponsor unlocking scripts, then runs the full script check offline.
//
// Evidence level of this module: R-VM / regtest with a software "wallet". Real-wallet mainnet runs (Paytaca): F1, A1, F2, A3 (docs/evidence/M1-M3).
import { binToHex, hexToBin, hash160, sha256, decodeTransactionBch, encodeTransactionBch, encodeLockingBytecodeP2pkh, createVirtualMachineBch2026, hashTransactionUiOrder } from '@bitauth/libauth';
import { SpendError } from './errors.mjs';
import { buildTx, inspectTx, SIGHASH_61 } from './spend.mjs';

const need = (c, code, m) => { if (!c) throw new SpendError(code, m); };
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const bytesOf = (b) => (b instanceof Uint8Array ? b : hexToBin(b));

// WizardConnect hdwalletv1 well-known path names. Sponsor inputs may sit on any of them.
export const WC_PATHS = Object.freeze({ receive: 0, change: 1, defi: 7 });
export const SIGHASH_BYTE = 0x61;
export const P2PKH_UNLOCK_LEN = 100; // 0x41 <65-byte Schnorr sig + sighash byte> 0x21 <33-byte compressed pubkey>

const isP2pkh = (l) => l.length === 25 && l[0] === 0x76 && l[1] === 0xa9 && l[2] === 0x14 && l[23] === 0x88 && l[24] === 0xac;

// Relay-safe JSON form of a source output (same shape @wizardconnect/core's sourceOutputToRelay produces):
// bytes -> lowercase hex, bigint -> "<bigint: Nn>". The relay only does JSON.stringify, so the dapp must do this.
export function sourceOutputToRelay(so) {
  need(!so.token, 'WcToken', 'GigPact source outputs carry no tokens');
  return {
    outpointTransactionHash: binToHex(so.outpointTransactionHash), outpointIndex: so.outpointIndex,
    unlockingBytecode: binToHex(so.unlockingBytecode), sequenceNumber: so.sequenceNumber,
    valueSatoshis: `<bigint: ${so.valueSatoshis}n>`, lockingBytecode: binToHex(so.lockingBytecode),
  };
}

// Find which wallet path/index holds a sponsor P2PKH lock. derive(pathName, index) -> 33-byte pubkey | undefined
// (in the app: dapp.getPubkey(WC_PATHS[name], BigInt(index))). Throws if the wallet does not control the lock
// within the first `max` indexes, so a sponsor input the wallet cannot sign is caught BEFORE the request is sent.
export function findSponsorPath(lock, derive, { max = 50, names = Object.keys(WC_PATHS) } = {}) {
  const l = bytesOf(lock);
  need(isP2pkh(l), 'SponsorNotP2pkh', 'a wallet-signed sponsor input must be a plain P2PKH output');
  for (const name of names) {
    need(Object.hasOwn(WC_PATHS, name), 'BadPathName', `unknown path name ${String(name)}`);
    for (let i = 0; i < max; i++) {
      const pk = derive(name, i);
      if (pk && same(encodeLockingBytecodeP2pkh(hash160(pk)), l)) return [name, i];
    }
  }
  throw new SpendError('SponsorNotInWallet', `the connected wallet does not control this sponsor address (searched ${names.join('/')} up to index ${max - 1})`);
}

// A sponsor "unlocker" whose script is a 100-byte dummy of the exact final shape. It lets buildTx fit the fee for the
// size the wallet's real P2PKH script will have (Schnorr signatures are fixed width). It signs nothing; the dummy is
// blanked below before anything is sent, and no key is involved.
const dummyP2pkhUnlock = () => Uint8Array.from([0x41, ...new Uint8Array(65), 0x21, ...new Uint8Array(33)]);
// A plain custom unlocker (not cashscript's `placeholder` kind, which adds its own size allowance on top of real bytes).
const sponsorPlaceholder = () => ({ generateUnlockingBytecode: dummyP2pkhUnlock });

// plan: planSpend result. keys: role keys {V, W, A} (only the plan's signer is used). sponsorPaths: [[name, index], ...],
// one per sponsor in plan order (use findSponsorPath).
export function prepareSign(plan, { provider, keys, SignatureTemplate, changeLock, sponsorPaths, userPrompt }) {
  need(Array.isArray(sponsorPaths) && sponsorPaths.length === plan.sponsors.length, 'SponsorPaths', 'one [pathName, addressIndex] per sponsor input is required');
  sponsorPaths.forEach((sp, k) => {
    need(Array.isArray(sp) && sp.length === 2 && Object.hasOwn(WC_PATHS, sp[0]) && Number.isInteger(sp[1]) && sp[1] >= 0 && sp[1] <= 0x7fffffff, 'SponsorPaths', `sponsor ${k}: expected [receive|change|defi, non-negative integer]`);
    need(isP2pkh(bytesOf(plan.sponsors[k].lockingBytecode)), 'SponsorNotP2pkh', `sponsor ${k} must be a plain P2PKH output to be signed by a wallet`);
  });
  const built = buildTx(plan, { provider, keys, SignatureTemplate, changeLock, sponsorUnlock: sponsorPlaceholder });
  const tx = decodeTransactionBch(hexToBin(built.hex));
  need(typeof tx === 'object', 'BadTx', String(tx));
  const nIn = 1 + plan.sponsors.length;
  need(tx.inputs.length === nIn, 'PlanMismatch', 'input count differs from the plan');
  // keep the complete contract unlocking script, blank every sponsor script (the wallet fills those)
  const contractUnlock = Uint8Array.from(tx.inputs[0].unlockingBytecode);
  need(contractUnlock.length > 0, 'BadTx', 'contract input has no unlocking bytecode');
  for (let i = 1; i < nIn; i++) tx.inputs[i] = { ...tx.inputs[i], unlockingBytecode: new Uint8Array(0) };
  const unsignedHex = binToHex(encodeTransactionBch(tx));
  const srcs = [plan.input0, ...plan.sponsors];
  const sourceOutputs = tx.inputs.map((inp, i) => ({
    outpointTransactionHash: inp.outpointTransactionHash, outpointIndex: inp.outpointIndex, unlockingBytecode: inp.unlockingBytecode,
    sequenceNumber: inp.sequenceNumber, valueSatoshis: srcs[i].satoshis, lockingBytecode: Uint8Array.from(bytesOf(srcs[i].lockingBytecode)),
  }));
  const request = {
    transaction: { transaction: unsignedHex, sourceOutputs: sourceOutputs.map(sourceOutputToRelay), ...(userPrompt ? { userPrompt } : {}) },
    inputPaths: sponsorPaths.map(([name, index], k) => [1 + k, name, index]),
  };
  const expected = Object.freeze({
    plan, changeLock: Uint8Array.from(bytesOf(changeLock)), unsignedHex, sourceOutputs, size: built.size, fee: built.fee, change: built.change,
    hasChange: built.hasChange, sponsorPaths: sponsorPaths.map((sp) => [...sp]), contractUnlock,
  });
  return { request, expected };
}

// What a P2PKH unlocking script from a wallet must look like. Returns { sig, pubkey } or throws.
function parseP2pkhUnlock(u, k) {
  need(u.length === P2PKH_UNLOCK_LEN, 'WalletScript', `sponsor input ${k}: unlocking script is ${u.length} bytes, expected ${P2PKH_UNLOCK_LEN} (a 65-byte Schnorr signature and a 33-byte key)`);
  need(u[0] === 0x41 && u[66] === 0x21, 'WalletScript', `sponsor input ${k}: unlocking script is not <65-byte sig> <33-byte pubkey>`);
  const sig = u.slice(1, 66), pubkey = u.slice(67, 100);
  need(sig[64] === SIGHASH_BYTE, 'WalletSighash', `sponsor input ${k}: signature hash type is 0x${sig[64].toString(16)}, expected 0x61 (ALL|FORKID|UTXOS)`);
  return { sig, pubkey };
}

// Check the wallet's answer against what we asked for. response: { signedTransaction, error? } as in
// sign_transaction_response. derive is optional (same callback as findSponsorPath) and additionally pins each
// sponsor key to the exact path/index we named. Returns the verified hex and its txid; throws SpendError otherwise.
export function verifySigned(expected, response, { derive, vm = createVirtualMachineBch2026() } = {}) {
  need(response && typeof response === 'object', 'WalletResponse', 'no response object');
  need(!response.error, 'WalletRejected', `the wallet refused: ${String(response.error)}`);
  const hex = response.signedTransaction;
  need(typeof hex === 'string' && /^(?:[0-9a-fA-F]{2})+$/.test(hex), 'WalletResponse', 'signedTransaction is missing or not hex');
  const tx = decodeTransactionBch(hexToBin(hex));
  need(typeof tx === 'object', 'WalletResponse', `signedTransaction does not decode: ${String(tx)}`);
  const { plan } = expected;
  const nIn = 1 + plan.sponsors.length;
  need(tx.inputs.length === nIn, 'WalletAltered', 'the wallet changed the number of inputs');
  // 1. strip the sponsor scripts: the rest must equal our request byte for byte (outputs, order, version, locktime, sequences, contract script)
  const stripped = { ...tx, inputs: tx.inputs.map((inp, i) => (i === 0 ? inp : { ...inp, unlockingBytecode: new Uint8Array(0) })) };
  need(binToHex(encodeTransactionBch(stripped)) === expected.unsignedHex, 'WalletAltered', 'the signed transaction differs from the requested one outside the sponsor unlocking scripts');
  // 2. each sponsor script must be a well-formed P2PKH unlock with sighash 0x61 and a key that hashes to the lock
  for (let i = 1; i < nIn; i++) {
    const { pubkey } = parseP2pkhUnlock(tx.inputs[i].unlockingBytecode, i);
    const lock = bytesOf(plan.sponsors[i - 1].lockingBytecode);
    need(same(encodeLockingBytecodeP2pkh(hash160(pubkey)), lock), 'SponsorKeyMismatch', `sponsor input ${i}: the signing key does not match the sponsor address`);
    if (derive) {
      const [name, idx] = expected.sponsorPaths[i - 1], want = derive(name, idx);
      need(want && same(want, pubkey), 'SponsorPathMismatch', `sponsor input ${i}: the key is not the one at ${name}/${idx}`);
    }
  }
  // 3. full offline script check of every input (the role signature on the contract input AND the wallet's signatures)
  const sourceOutputs = expected.sourceOutputs.map((s) => ({ lockingBytecode: s.lockingBytecode, valueSatoshis: s.valueSatoshis }));
  for (let i = 0; i < nIn; i++) {
    const r = vm.verify({ inputIndex: i, transaction: tx, sourceOutputs });
    need(r === true, 'ScriptInvalid', `input ${i} fails script verification: ${String(r)}`);
  }
  // 4. accounting against the plan (fee, change, contract outputs) and the size we fitted the fee for
  const a = inspectTx(plan, hex, expected.changeLock);
  need(a.size === expected.size && a.fee === expected.fee, 'WalletAltered', `size/fee changed (${a.size} B / ${a.fee} sat, expected ${expected.size} B / ${expected.fee} sat)`);
  const txid = binToHex(hashTransactionUiOrder(hexToBin(hex)));
  return { hex: hex.toLowerCase(), txid, size: a.size, fee: a.fee, change: a.change };
}

// Parse a wallet-side view of the request exactly as a wallet would (JSON round trip + the package's own parsers).
// Used by the software wallet in the tests; exported so the UI "dry run" can show the user what the wallet will see.
export const requestToJson = (req) => JSON.stringify(req);
export { sha256, SIGHASH_61 };


=== src/errors.mjs ===
export class SpendError extends Error { constructor(code, m) { super(`${code}: ${m}`); this.name = 'SpendError'; this.code = code; } }

// A real-looking outpoint: 64 hex chars (any case) and a non-negative 32-bit index.
export function checkOutpoint(u, what = 'outpoint') {
  if (!(u && typeof u.txid === 'string' && /^[0-9a-fA-F]{64}$/.test(u.txid) && Number.isInteger(u.vout) && u.vout >= 0 && u.vout <= 0xffffffff)) throw new SpendError('BadOutpoint', `${what}: txid must be 64 hex chars and vout a non-negative 32-bit integer`);
}

// Strict byte conversion: hex strings must be even-length valid hex, anything else must already be a Uint8Array.
// (libauth's hexToBin silently turns malformed hex into other bytes, which could silently redirect funds.)
export function strictBytes(b) {
  if (b instanceof Uint8Array) return b;
  if (typeof b === 'string' && /^(?:[0-9a-fA-F]{2})*$/.test(b)) {
    const out = new Uint8Array(b.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(b.slice(2 * i, 2 * i + 2), 16);
    return out;
  }
  throw new SpendError('BadBytes', 'expected a Uint8Array or an even-length hex string');
}


=== web/pact.js ===
// Pure helpers for the pact link, keys and addresses. No DOM here.
import { secp256k1, hash160, sha256, encodeLockingBytecodeP2pkh, decodeCashAddress, lockingBytecodeToCashAddress, cashAddressToLockingBytecode, binToHex, hexToBin } from '@bitauth/libauth';
import { buildChain, normalize } from '../src/chain.mjs';
import { FA, ARBITER_PK, NET, PREFIX } from './config.js';

export class UiError extends Error { constructor(m) { super(m); this.name = 'UiError'; } }
const need = (c, m) => { if (!c) throw new UiError(m); };

export const newKey = () => { let k; do { k = crypto.getRandomValues(new Uint8Array(32)); } while (!secp256k1.validatePrivateKey(k)); return k; };
export const pubOf = (k) => secp256k1.derivePublicKeyCompressed(k);
export const lockOfPk = (pk) => encodeLockingBytecodeP2pkh(hash160(pk));
export const ARBITER = { pk: hexToBin(ARBITER_PK), lock: lockOfPk(hexToBin(ARBITER_PK)) };

// Regular (P2PKH) Bitcoin Cash address of the right network. Token-aware addresses are refused on purpose.
export function parseAddress(text) {
  const s = String(text).trim();
  need(s.length > 0, 'Enter a Bitcoin Cash address.');
  const full = s.includes(':') ? s : `${PREFIX}:${s}`;
  const d = decodeCashAddress(full);
  need(typeof d === 'object', 'That does not look like a valid Bitcoin Cash address.');
  need(d.prefix === PREFIX, `This app is on ${NET}. Use an address that starts with "${PREFIX}:".`);
  need(d.type === 'p2pkh', 'Use a regular wallet address (it starts with "q"), not a token-aware or script address.');
  const r = cashAddressToLockingBytecode(full);
  need(typeof r === 'object', 'That does not look like a valid Bitcoin Cash address.');
  return r.bytecode;
}
export const addressOf = (lock) => lockingBytecodeToCashAddress({ bytecode: lock, prefix: PREFIX }).address;

// "0.0015" -> 150000n sat (exact, no floating point)
export function parseBch(text) {
  const s = String(text).trim().replace(',', '.');
  need(/^\d+(\.\d{1,8})?$/.test(s), 'Enter the fee as a number of BCH, for example 0.002.');
  const [w, f = ''] = s.split('.');
  return BigInt(w) * 100_000_000n + BigInt((f + '00000000').slice(0, 8));
}
export function fmtBch(sat) {
  const w = sat / 100_000_000n, f = (sat % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return f ? `${w}.${f}` : `${w}`;
}

// ---- pact link: worker request (r) and organizer reply (p = r + V data) ---------------------------------
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const HEX33 = /^0[23][0-9a-f]{64}$/, HEXLOCK = /^76a914[0-9a-f]{40}88ac$/; // 33-byte key; 25-byte P2PKH lock (exactly that script, nothing else)
export const cleanName = (s) => String(s).replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, 60);

export function encodePact(o) {
  const body = { v: 1, n: NET, name: cleanName(o.name), F: o.F.toString(), tEnd: o.tEnd, pkW: binToHex(o.pkW), lockW: binToHex(o.lockW) };
  if (o.pkV) { body.pkV = binToHex(o.pkV); body.lockV = binToHex(o.lockV); }
  return b64u(new TextEncoder().encode(JSON.stringify(body)));
}
export function decodePact(code) {
  let o;
  try { o = JSON.parse(new TextDecoder().decode(unb64u(String(code)))); } catch { throw new UiError('This pact link is damaged. Ask for a new one.'); }
  need(o && typeof o === 'object' && o.v === 1, 'This pact link is from a different version of the app.');
  need(o.n === NET, `This pact is for ${o.n}, but the app is on ${NET}.`);
  need(typeof o.name === 'string' && o.name.length <= 60 && cleanName(o.name) === o.name, 'This pact link is damaged.');
  need(/^\d{1,16}$/.test(String(o.F)) && Number.isInteger(o.tEnd) && o.tEnd > 0 && o.tEnd < 500_000_000, 'This pact link is damaged.');
  need(HEX33.test(o.pkW) && HEXLOCK.test(o.lockW), 'This pact link is damaged.');
  const out = { name: o.name, F: BigInt(o.F), tEnd: o.tEnd, pkW: hexToBin(o.pkW), lockW: hexToBin(o.lockW) };
  if (o.pkV !== undefined || o.lockV !== undefined) { need(HEX33.test(o.pkV) && HEXLOCK.test(o.lockV), 'This pact link is damaged.'); out.pkV = hexToBin(o.pkV); out.lockV = hexToBin(o.lockV); }
  return out;
}
// Fingerprint of the terms a role holder entered. It is stored next to that role's key; a link whose terms differ is refused.
export const termsOf = (p, withV) => binToHex(sha256.hash(new TextEncoder().encode(JSON.stringify([p.name, p.F.toString(), p.tEnd, binToHex(p.pkW), binToHex(p.lockW), ...(withV ? [binToHex(p.pkV), binToHex(p.lockV)] : [])]))));
export const pactId = (code) => binToHex(sha256.hash(new TextEncoder().encode(String(code)))).slice(0, 16);

// The chain for a complete pact (V and W known). Throws the library's own ParamError if the numbers are not allowed.
export function chainFor(p, provider) {
  need(p.pkV && p.lockV, 'Organizer details are missing.');
  return buildChain({ pk: { V: p.pkV, W: p.pkW, A: ARBITER.pk }, lock: { V: p.lockV, W: p.lockW, A: ARBITER.lock }, F: p.F, fA: FA, tEnd: BigInt(p.tEnd) }, { provider });
}
// Early check on the worker's side (V not known yet): same numeric rules, with W standing in for V.
export function checkNumbers(p) {
  return normalize({ pk: { V: p.pkW, W: p.pkW, A: ARBITER.pk }, lock: { V: p.lockW, W: p.lockW, A: ARBITER.lock }, F: p.F, fA: FA, tEnd: BigInt(p.tEnd) });
}


=== web/config.js ===
// App configuration. Network: mainnet unless ?net=chipnet is in the URL (development only).
export const NET = new URLSearchParams(location.search).get('net') === 'chipnet' ? 'chipnet' : 'mainnet';
export const PREFIX = NET === 'mainnet' ? 'bitcoincash' : 'bchtest';
export const FA = 2000n; // arbiter fee fA (sat), default of the architecture (K12: fA <= F/4)
// Demo arbiter: a public key whose private key was generated once and not kept (the author cannot prove that from the repository).
// It only matters for the dispute paths, which are closed in this UI. Replace it with a real arbiter key before they are opened.
export const ARBITER_PK = '0397ea49320bea869b7c18ec5eff57e7bf4beb119c13534fad9250df19d065b05a';
export const MIN_FEE_SAT = 10000n;       // UI minimum fee for a gig (contract minimum is 8,000 sat with fA = 2,000)
export const MIN_LEAD_BLOCKS = 6;        // the event end must be at least ~1 hour away

// Links shown in the home page banner (hackathon rule). PRESENTATION_URL must be shared publicly by the author before judging.
export const REPO_URL = 'https://github.com/gigpact-app/gigpact';
export const PRESENTATION_URL = 'https://claude.ai/artifact/EwUz88Njp9BfpEuuD4QYts';
export const DECLARATION_URL = `${REPO_URL}/blob/main/docs/DECLARATION.md`;
export const BEFORE_AFTER_URL = `${REPO_URL}/blob/main/docs/BEFORE-AFTER.md`;
// CashTokens-capable address for EMBER2026 donations (Community Choice). Copied from the author's wallet on 16 Nov 2026.
export const TOKEN_ADDR = 'bitcoincash:zpgcz25vg4f2rqd95qgs5qquwkzcuumy6g5lhutl8r';

