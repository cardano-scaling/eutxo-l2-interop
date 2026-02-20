# Milestone 4

Consists of three parts:
1. Adversarial Scenarios
2. Ad-hoc ledger V4 specification
3. Test suite

This milestone focuses on adversarial scenarios and implements the dispute mechanism to ensure that funds cannot get stuck indefinitely.

## Adversarial Scenarios

Adversarial scenarios occur when parties involved in a cross-ledger operation fail to cooperate. These situations are secured by two primary mechanisms: the on-chain smart contracts ensure that funds cannot be stolen or permanently locked, while the Hydra Head protocol ensures that progress is possible even if some participants become unresponsive.

An important aspect of these L2-to-L1 transitions is the **Hydra contestation period**. Before any disputed state can be settled on L1, the head must be closed and fanned out. This requires waiting for a contestation window, which in production environments may last for several days. Only after this period has elapsed can the final L1 transactions be submitted to resolve the dispute.

In this milestone, we consider two primary adversarial scenarios:

### Dispute in L2 and merge on L1

In this scenario, a party (e.g., an intermediary) ceases cooperation with the adhoc-ledger protocol (but continues to participate in the Hydra Head) after funds have already been wrapped. The dispute is initiated within the L2 Hydra Head, but final resolution occurs on L1 after the head is closed.

1. **Setup**: Alice wraps `X` ADA in Head A. Intermediaries Ida and Jhon wrap their collateral in Head B. Both UTxOs share the same `nonce`.
2. **Stall**: Jhon stops responding (e.g., refusing to sign a `Verify` transaction).
3. **Dispute (L2)**: Alice invokes the `Dispute` redeemer on her Wrapped UTxO within Head A. This marks the UTxO as disputed and starts an internal timeout.
4. **Dispute (L2)**: Ida calls `Dispute` on the Collateral UTxO in Head B to protect her funds from being locked by Jhon's inaction.
5. **Fanout**: The Hydra heads are closed. After the contestation period expires, the disputed UTxOs are fanned out to the L1 ledger.
6. **Merge (L1)**: On L1, the fanned-out disputed UTxOs are spent together in a single `Merge` transaction.
    * Alice recovers her original `X` ADA.
    * Ida and Jhon recover their respective collateral.

```mermaid
sequenceDiagram
    participant AliceL2 as L2 (Head A)
    participant CollatL2 as L2 (Head B)
    participant L1 as L1 Ledger

    AliceL2->>AliceL2: Wrap Funds (X ADA)
    CollatL2->>CollatL2: Wrap Collateral (Ida & Jhon)

    Note over AliceL2, CollatL2: Jhon Stalls

    AliceL2->>AliceL2: Dispute Wrapped UTxO
    CollatL2->>CollatL2: Ida Disputes Collateral UTxO

    AliceL2->>L1: Fanout (Disputed UTxO)
    CollatL2->>L1: Fanout (Disputed UTxO)

    L1->>L1: Merge Disputed UTxOs
    Note right of L1: Alice gets X ADA<br>Ida & Jhon get collateral
```

### Dispute and merge on L1

In this scenario, an intermediary stops signing Hydra snapshots entirely, effectively freezing the L2 head and preventing even L2 transactions like `Dispute`. The participants must force-close the heads, moving the dispute logic to L1.

1. **Setup**: Alice wraps `X` ADA in Head A. Intermediaries Ida and Jhon wrap their collateral in Head B.
2. **Stall**: Jhon refuses to sign new snapshots. Head B can no longer progress.
3. **Fanout**: Participants close the heads (i.e., Ida closes Head B to avoid losing collateral). Once the contestation period ends, the Wrapped UTxOs fan out to L.
4. **Dispute (L1)**: On L1, Alice calls `Dispute` on her fanned-out Wrapped UTxO.
5. **Dispute (L1)**: Similarly, Ida calls `Dispute` on the Collateral UTxO on L1.
6. **Merge (L1)**: Once both replicas are marked as disputed on L1, they are merged in a single transaction, refunding all parties.

```mermaid
sequenceDiagram
    participant AliceL2 as L2 (Head A)
    participant CollatL2 as L2 (Head B)
    participant L1 as L1 Ledger

    AliceL2->>AliceL2: Wrap Funds (X ADA)
    CollatL2->>CollatL2: Wrap Collateral (Ida & Jhon)

    Note over AliceL2, CollatL2: Jhon stops signing snapshots

    AliceL2->>L1: Force Close (Fanout Wrapped UTxO)
    CollatL2->>L1: Ida Force Closes (Fanout Collateral UTxO)

    L1->>L1: Dispute Alice's UTxO
    L1->>L1: Dispute Collateral UTxO

    L1->>L1: Merge Disputed UTxOs
    Note right of L1: Alice gets X ADA<br>Ida & Jhon get collateral
```
### Midgard <> Hydra Scenarios

Scenarios involving Midgard follow a similar logic but benefit from different liveness guarantees. Unlike a Hydra Head, which can be stalled if a single participant stops signing, Midgard works by having multiple operators that take turns in a round-robin system validating transactions and modifying the ledger.

If a specific operator refuses to validate transactions, the user simply waits for the next operator's shift to resubmit the transaction. This inherent robustness applies to both the `Dispute` transaction on L2 and the `Withdraw` event used to bridge UTxOs back to L1.

However, Midgard also imposes a delay: the **confirmation period**. Similar to Hydra's contestation period, Midgard requires a waiting period (which can last up to a week according to the specification) before an event is considered final and can be used on L1. Once this period passes, the rest of the L1 resolution flow (Dispute and Merge) remains identical to the Hydra scenarios described above.

## Contract Design - Version 4

> [!WARNING]
> This implementation is a **proof of concept** and should not be considered safe to use in it's current state

This new version of the contract modifies the `verify-perform` mechanism again, removing the token minting and consolidating reserved inputs into a single UTxO. To allow this operation to be reversed, the original inputs are stored in the inputs field of the `VerifiedDatum`. The outputs that need to be generated after the perform step are stored in the outputs field of the same datum.

Version 4 also introduces a **dispute mechanism** to prevent cross-ledger operations from getting stuck indefinitely. This is achieved by adding new redeemers (`Dispute`, `Merge`, `Punish`) and new datum fields (`disputed`, `timeout`, `nonce`) to the wrapped UTxO validator.

This way, if an intermediary stalls the protocol, any participant can **dispute** the wrapped UTxO. Once disputed in both replicas, the UTxOs can be **merged** on L1 (after head fanout) to recover the funds. If the counterparty does not cooperate with the merge, the disputer can **punish** them after the timeout, claiming all value including collateral.

### Wrapped UTxOs

L2 users send UTxOs to the Wrapped script address to make them available in the ad-hoc ledger.

* Address: Wrapped script
* Value: any
* Datum:
  * owner: VerificationKeyHash
  * intermediaries: Pairs\<VerificationKeyHash, Int\> (maps intermediary → their collateral share in lovelace)
  * nonce: OutputReference
  * disputed: Bool
  * timeout: Option\<Int\>

### Wrapped script

* Spend purpose redeemers:
  * Unwrap
  * Verify
  * Dispute
  * Merge
  * Punish

### Verified UTxOs

The verified validator stores the state of a verified transaction, including the inputs (for reverting) and outputs (for performing).

* Address: Verified script
* Value: the locked value
* Datum:
  * inputs: List\<DesiredOutput\> (for reverting to previous state)
  * outputs: List\<DesiredOutput\> (for performing the intended state change)

### Verified script

* Spend purpose redeemers:
  * Revert
  * Perform

### Operations overview

#### Wrap

Sends a user UTxO to the Wrapped script address. No on-chain validation is run during wrapping; the user simply pays to the script with an inline datum.

![Wrap UTxO](tx_wrap_v4.svg)

#### Unwrap

Consumes a Wrapped UTxO and sends the value back to the owner. Must be signed by the owner.

![Unwrap UTxO](tx_unwrap_v4.svg)

#### Dispute

Consumes a Wrapped UTxO with the `Dispute` redeemer. This marks the UTxO as disputed and sets a timeout. Either the owner or an intermediary can initiate the dispute.

The validator enforces:

* Signer is owner **or** an intermediary
* Datum fields `owner`, `intermediaries`, and `nonce` are preserved
* `disputed` is set to `True`
* `timeout` is set to `Some(T)`
* Value and address are preserved

![Dispute UTxO](tx_dispute_v4.svg)

#### Merge

Consumes **both** disputed replicas (same `nonce`) in a single transaction on L1 after the heads have been fanned out. This resolves the dispute by unwrapping the value to the owner and distributing collateral to intermediaries.

The validator enforces:

* The UTxO being spent is disputed (`disputed == True`)
* A replica input exists with the same `nonce` and same script address, and it is also disputed
* The first output sends the value to the owner's address
* Subsequent outputs distribute to intermediaries according to the `intermediaries` pairs

![Merge dispute](tx_merge_v4.svg)

#### Punish

If the dispute timeout expires without a merge resolution, the owner can claim **all** value from the disputed UTxO, including collateral. This disincentivizes intermediaries from stalling indefinitely.

The validator enforces:

* The timeout has expired
* Signed by the owner

![Punish timeout](tx_punish_v4.svg)

#### Verify

Consumes a Wrapped UTxO with the `Verify` redeemer and pays to the Verified contract. The verified datum stores both the original inputs and the intended outputs.

![Verify UTxO](tx_verify_v4.svg)

#### Revert

Consumes a Verified UTxO with the `Revert` redeemer and restores the original Wrapped UTxOs.

![Revert](tx_revert_v4.svg)

#### Perform

Consumes a Verified UTxO with the `Perform` redeemer and produces the intended outputs as new Wrapped UTxOs. Must be signed by all intermediaries

![Perform](tx_perform_v4.svg)


## Test suite

This milestone includes a comprehensive test suite designed to validate the adversarial scenarios through two distinct approaches:

1.  **Emulator-based Tests**: These tests utilize an emulator to verify the on-chain contract logic in isolation. Because they offer several advantages, including faster execution and lower computational overhead, they are integrated into our GitHub Actions workflow.

2.  **End-to-End Local Node Tests**: These tests run against a full local Cardano node and using real Hydra Heads. They validate the entire system's behavior, including the lifecycle of Hydra Heads (opening, committing funds, disputing UTxOs, and closing).
