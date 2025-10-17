# Milestone 1

Consists of two parts
1. HTLC prototype of payment between two L2s
2. Transaction design for ad-hoc ledgers


## HTLC payment

Example workflow of a payment of some `$USDM` from `Alice` to `Bob` via one intermediary `Ida` using Hash-Time-Locked Contracts (HTLC).

![](./l2-htlc-payment.excalidraw.svg)

 The topology of the involved L2s is not further specified here, but could be for example two Hydra heads between `Alice-Ida` and `Ida-Bob`, or a two-party head beween `Alice-Ida` and both, `Ida` and `Bob` being participants of a Midgard optimistic rollup. Even multi-party heads where multiple intermediaries could share the collateral across multiple HTLC outputs are thinkable, but that would need further investigation how we can guarantee collateralization across multiple outputs.

## HTLC Design

The HTLC is implemented as a single validator, with two possible redeemers, `Claim` and `Refund`. No validation is run during the `Lock` operation.

### UTxOs Specification

#### HTLCUtxo

> **Address**
>
> - Script address

> **Datum**
>
> - hash: ByteString
> - timeout: PosixTime
> - sender: VerificationKeyHash
> - receiver: VerificationKeyHash

> **Value**
>
> - min ADA
> - offered tokens

### Transactions

#### Lock Funds

Creates an `HTLCUtxo` containing the offered tokens. The datum specifies the sender and receiver Verification keys for future authetication, as well as the timeout in posix time and the hash of the secret needed to claim the funds.

In step 1 of our example, Alice would execute this transaction and specify herself as the sender, Ida as the receiver, a timeout sufficiently in the future and the hash shared by Bob. In step 3, Ida would execute this transaction and specify themselves as the sender, Bob as the receiver, a timeout slightly lower than the one Alice specified and the same hash used in step 1.

The lower timeout is needed to avoid a situation where Bob claims the funds in Head B and Ida is unable to claim their share in Head A.

![Lock funds into HTLC](tx_lock_htlc.svg)

#### Claim Funds

Consumes a `HTLCUtxo` with the `Claim` redeemer, providing the preimage of the stored hash. This transaction must be submited before the timeout and must be signed by the receiver.

In step 4, Bob uses the preimage that they generated in step 0 to claim the funds. In step 6, Ida uses the preimage that they learned from Bob's transaction to unlock the funds locked by Alice.

![Claim funds from HTLC](tx_claim_htlc.svg)

#### Refund

Consumes a `HTLCUtxo` with the `Refund` redeemer. This transaction must be submited after the timeout and be signed by the sender.

![Refund funds from HTLC](tx_refund_htlc.svg)
