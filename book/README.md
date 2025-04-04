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
- [Interhead Hydra](https://eprint.iacr.org/2021/1188): Full virtual Hydra state channels
- [SoK: Communication Across Distributed Ledgers](https://eprint.iacr.org/2019/1128): Overview of cross chain communication and generic model of such protocols.

### Reading list

- [CRATE: Cross-Rollup Atomic Transaction Execution](https://www.arxiv.org/pdf/2502.04659): coordinates transactions spanning multiple rollups such that they execute in an all-or-nothing manner with 4-round finality on the Layer-1.
- [Optimism’s Superchain Interoperability (2024)](https://docs.optimism.io/stack/interop/explainer)
- [Cross-Rollup MEV: Non-Atomic Arbitrage Across L2 Blockchains]( https://arxiv.org/html/2406.02172v2#:~:text=average%2C%20for%C2%A010%20to%C2%A020%20blocks%2C%20necessitating,25)
