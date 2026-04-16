## About the Project

**Name:**

EUTxO-L2 interoperability: Connect Hydra and other L2s

**Project Catalyst URL:**

https://projectcatalyst.io/funds/13/cardano-open-developers/eutxo-l2-interoperability-connect-hydra-and-other-l2s

**Project Number:**

\#1300098

**Name of project manager:**

Sebastian Nagel

**Date project started:**

September, 2025

**Date project completed:**

April, 2026

## Challenge KPIs

The *Cardano Open: Developers* challenge seeks to enhance the developer experience by providing tools, patterns, and infrastructure that unlock new use cases. The EUTxO L2 Interoperability project evaluates, designs, and prototypes mechanisms for atomic cross-ledger interactions, allowing the Cardano ecosystem to connect multiple Layer 2 solutions, such as Hydra heads.

By implementing both HTLC-based payments and sophisticated Ad-hoc Ledgers spanning disparate Layer 2 states, this project creates a path for seamless cross-rollup transactions and sharing of liquidity across the broader Cardano ecosystem.

## Project KPIs

The project progressed through 5 milestones:

1. Implementation of **HTLC-based single-hop protocols**, enhanced to support sophisticated transaction outputs such as Vesting contracts across isolated L2s.

1. Design and prototyping of **Ad-hoc Ledgers (verify-perform mechanism)** to execute atomic cross-ledger transactions.

1. Comprehensive evaluation of **multi-L2 topologies** (e.g., hub-and-spoke, single-path networks), modeling transaction efficiency, cost, and comparative liquidity constraints.

1. Implementation of a robust **dispute resolution mechanism** for handling adversarial scenarios across L1/L2 boundaries, covering dispute tracking inside L2s and L1 resolutions via head fanouts and collateral slashing.

1. A **working end-to-end multi-L2 dApp**, demonstrated with a cross-ledger Lottery example, running securely across three separate Hydra heads leveraging liquidity intermediaries.

Full documentation published summarizing topologies, mechanisms, and transaction design.

All source code released securely under open-source via GitHub.

## Key Achievements

* **Robust Cross-Ledger Primitives**: Prototyped multiple iterations of Ad-Hoc ledgers, securely consolidating from early verify/perform mechanism concepts into Version 4 smart contracts featuring complete lifecycle dispute/punish/merge resolutions.

* **Topology Cost & Efficiency Framework**: Provided actionable analysis of Transaction Cost vs Liquidity Cost trade-offs and recommended a balanced multi-L2 topology integrating hub-and-spoke networks to scale efficiently.

* **Unified L1/L2 Dispute Resolution**: Enabled adversarial protections extending L2-initiated disputes and transferring those states gracefully into L1 resolution logic when L2 protocols unexpectedly stall.

* **End-to-End Multi-Head Lottery dApp**: Designed an example demonstrating how disparate parties across both Custodial and Non-Custodial network topologies trustlessly collaborate on a single-application spanning across separate Layer 2 state machines.

## Key Learnings

* **HTLC Limitations in Single-Party Actions**: Basic Hash Timelock Contracts (HTLCs) only work well when two parties are incentivized to complete the transaction.

* **Connecting Multiple L2s**: Creating long, multi-step connections between networks is too expensive and requires locking up too many funds. Using a central hub (the hub-and-spoke model) is a much cheaper and more efficient way to connect multiple Hydra heads.

* **Handling Disputes and Delays**: Moving disputes back to the main Cardano network takes time —often days— due to the way systems like Hydra handle finality.

* **Ad-hoc Ledgers are Better for Bulk Payments**: If a user wants to send payments to a lot of people at the same time, HTLCs get expensive quickly. Ad-hoc ledgers package everything into a single transaction, making them more efficient.

* **Ad-hoc Ledgers are more cumbersome than expected**: While there are potential benefits of the ad-hoc ledger design, the implementation is more complex than expected. Furthermore, the benefits don't always translate well to the real world.

* **NFTs Require a Completely Different Approach**: The ad-hoc ledger strategy and HTLCs works well for ADA and FTs because middlemen can easily lock up equivalent amounts of their own funds as collateral. However, this model completely breaks down with NFTs

## Next Steps

* Research mechanisms to support Non-Fungible Tokens (NFTs)
* Add fine-grained collateral slashing.
* Drive further integration with other L2s like Midgard.
* Publish further guidance to facilitate frictionless multi-ledger app development.

## Final Thoughts

This project establishes the groundwork for connecting different Layer 2 networks. By showing how smart contracts can securely operate across networks using HTLCs, comparing the real-world effectiveness of two different models, and tackling the challenges of building ad-hoc ledgers across multiple Hydra heads, it lights a path forward. The foundation built here will make it much easier to develop powerful multi-network applications and explore new ways to scale Cardano in the future.

## Links

* **GitHub repository (source code):**

https://github.com/cardano-scaling/eutxo-l2-interop

* **Documentation:**

https://cardano-scaling.github.io/eutxo-l2-interop

* **Close-out video:**

https://www.youtube.com/watch?v=p_Dd2e892wU