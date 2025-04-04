# Milestone 1

Consists of two parts
1. HTLC prototype of payment between two L2s
2. Transaction design for ad-hoc ledgers


## HTLC payment

Example workflow of a payment of some `$USDM` from `Alice` to `Bob` via one intermediary `Ida` using Hash-Time-Locked Contracts (HTLC).

![](./l2-htlc-payment.excalidraw.svg)

 The topology of the involved L2s is not further specified here, but could be for example two Hydra heads between `Alice-Ida` and `Ida-Bob`, or a two-party head beween `Alice-Ida` and both, `Ida` and `Bob` being participants of a Midgard optimistic rollup. Even multi-party heads where multiple intermediaries could share the collateral across multiple HTLC outputs are thinkable, but that would need further investigation how we can guarantee collateralization across multiple outputs.
