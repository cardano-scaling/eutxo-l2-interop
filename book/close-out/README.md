# Close-out Report

## Challenges

### Circular dependency between verify and perform transactions

One of the most persistent design challenges was the circular dependency between `verify` and `perform` transactions in our first approaches. Since the `verify` step needed to reference the future `perform` transaction (e.g., by its hash), the `perform` transaction must be built *before* `verify`. However, `verify` may consume or modify UTxOs that `perform` also needs to reference, creating a chicken-and-egg problem.

### Single-party HTLC trust assumptions

The HTLC design works well for two-party interactions where both sender and receiver are motivated to complete the protocol (e.g., Alice pays Bob). However, in single-party scenarios — such as a user wanting to place a bet in a lottery on another head — the protocol degrades to a fully trusting model. The receiver has no way to verify that the intermediary created the correct `desired_output` on the destination head, and the intermediary could collude with other parties to alter timeouts or output parameters.

### Dispute resolution across L1/L2 boundaries

Handling adversarial scenarios where participants stop cooperating required careful design of the dispute mechanism across both L1 and L2 environments. The main difficulty lies in the fact that disputes can occur at multiple levels: an intermediary might stop cooperating within the ad-hoc ledger protocol while still participating in the Hydra Head, or they might stop signing snapshots entirely, freezing the head. Each scenario requires a different resolution path — dispute within L2 followed by fanout and merge on L1, or force-close followed by L1 dispute and merge. Additionally, the Hydra and Midgard contestation periods (which can last several days in production) introduce significant delays before on-chain resolution can happen.

## Optimizations

### Consolidation of reserved inputs into a single verified UTxO

In Version 2 of the contract design, each reserved input received its own validity token, minted during `verify` and burned during `perform`. This approach created scaling issues as the number of wrapped UTxOs grew. Version 4 consolidates all reserved inputs into a single Verified UTxO that stores the original inputs (for reverting) and the intended outputs (for performing) in its datum.

## Future Improvements

### Multi-intermediary collateral slashing

The current implementation simplifies collateral management by supporting a limited set of intermediaries without fine-grained tracking of individual contributions. A production system would need to enable proportional slashing when disputes occur.

### NFT support in the ad-hoc ledger mechanism

The current ad-hoc ledger mechanism is designed for ADA and fungible tokens, where value can be replicated across heads through collateralization. NFTs present a fundamental challenge: they are by definition unique and cannot be duplicated across replicas. 

### Integration with alternative L2s (Midgard)

While the current implementation targets Hydra Heads as the L2 layer, the ad-hoc ledger design is intentionally L2-agnostic. Midgard, an optimistic rollup for Cardano, offers different liveness guarantees that could complement or improve the system. Integrating Midgard would validate the generality of the protocol, but Midgard nodes are not currently production ready yet, so we intentionaly leave this for future work.
