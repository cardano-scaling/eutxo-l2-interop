# Introduction

This is the technical report for the Catalyst fund13 project "EUTxO L2
Interoperability". It will be used to gather and introduce background
information, but also as a delivery artifact for the various milestones.

The full list of milestones can be found
[here](https://milestones.projectcatalyst.io/projects/1300098) and the
corresponding chapters in this document will contain documentation, instructions
and links to other materials to reproduce or use our results in further work.


## Background

### Relevant research

- [State Machines across Isomorphic Layer 2 Ledgers](https://eprint.iacr.org/2023/1027.pdf): The main research piece that this project evaluates - about so-called ad-hoc ledgers where individual transactions are performed across multiple L2 ledgers atomically.
  - See [Logbook 2025-04-04](./logbook.md#2025-04-04) and [Logbook 2025-03-25](./logbook.md#2025-03-25) for notes on the paper
- [Interhead Hydra](https://eprint.iacr.org/2021/1188): Full virtual Hydra state channels
- [SoK: Communication Across Distributed Ledgers](https://eprint.iacr.org/2019/1128): Overview of cross chain communication and generic model of such protocols.

### Reading list

- [CRATE: Cross-Rollup Atomic Transaction Execution](https://www.arxiv.org/pdf/2502.04659): coordinates transactions spanning multiple rollups such that they execute in an all-or-nothing manner with 4-round finality on the Layer-1.
- [Optimism’s Superchain Interoperability (2024)](https://docs.optimism.io/stack/interop/explainer)
- [Cross-Rollup MEV: Non-Atomic Arbitrage Across L2 Blockchains]( https://arxiv.org/html/2406.02172v2#:~:text=average%2C%20for%C2%A010%20to%C2%A020%20blocks%2C%20necessitating,25)
- 

### Hash Timelock Contracts (HTLC)

Setting up an HTLC allows the sender to lock an asset to be spent "accordingly" or it allows them to get back their funds after a timeout. Not much scripting is required for this construction, hence it is popularly [used in Bitcoin Lightning](https://docs.lightning.engineering/the-lightning-network/multihop-payments/hash-time-lock-contract-htlc) to effectively forward payments between channels.

In Bitcoin Lightning, HTLCs are also used to _swap into_ and _out of_ lightning channels from the Bitcoin main chain. These atomic swaps are called [Submarine Swaps](https://docs.lightning.engineering/the-lightning-network/multihop-payments/understanding-submarine-swaps) and are fully trustless (no custody, no counterparty risk) because they share the same underlying chain / security model (= Bitcoin).

### Adaptor signatures

Originating from ideas on [Scriptless scripts](https://download.wpsoftware.net/bitcoin/wizardry/mw-slides/2017-03-mit-bitcoin-expo/slides.pdf) where correct execution of scripts is captured by the validity of digital signatures (elliptic curve based schemes), so-called adaptor signature schemes can be used to reveal information through the actual signature. Verifiably Encrypted Signatures (VES) are a generalization of this concept onto both Schnorr and ECDSA signature schemes.

Related work about [cross-chain atomic swaps between Bitcoin and Monero](https://eprint.iacr.org/2022/1650.pdf) suggests that adaptor signatures can be used to realize unlocking on even very constrained target chains (Monero). We are in a much more comfortable position of very scriptable ledgers.

Quite low-level treatment on the signature schemes: https://medium.com/crypto-garage/adaptor-signature-schnorr-signature-and-ecdsa-da0663c2adc4
