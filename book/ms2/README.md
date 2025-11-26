# Milestone 2

Consists of two parts:
1. HTLC + Vesting implementation
2. Ad-hoc ledgers `verify-perform` mechanism PoC
## HTLC + Vesting implementation

For this second milestone, we extended the HTLC contract implemented in MS1. By adding output validation, we allow the HTLC to enforce the creation of smart contract UTxOs during the claim operation. We also implemented a very simple vesting contact to use as an example of inter-head smart contract interaction.

The canonical use case for HTLCs, explained in MS1, require two parties interested in executing a transaction (Alice and Bob in our case). This way, the party that will receive the funds is in charge of generating the preimage and sharing the hash, the other party creates the HTLC. This dinamic is important, if there's only a single party interested in making the transaction, the flow breaks, so, in order to maintain it, the example we choose is a vesting contract, where Alice is sending funds to Bob, but they will be unlocked at a future time. Bob can share the preimage once the funds are guaranteed by the HTLC 2.0 contract to be sent to the vesting address with the appropiate timeout.

### HTLC 2.0 Improvements

We'll list the changes made from the HTLC desing in MS1, anything not mentioned in this document is the same as the previous version, which you can read more here (TODO: Add link)

The first change was to add a new data type called `HTLCOutput`, this type represents everything we want to specify as the desired output when claiming the HTLC, including a non-opaque representation of a Value and an optional datum (if a datum is included, we force it to be Inline).

#### UTxO Specification

> **Datum**
>
> - hash: ByteString
> - timeout: PosixTime
> - sender: VerificationKeyHash
> - receiver: VerificationKeyHash
> - desired_output: HtlcOutput
>
> **HTLCOutput**
>
> - address: Address
> - value: Pairs<PolicyId, Pairs<AssetName, Int>>
> - datum: Option<Data>

#### HTLC Transactions

##### Claim funds

Consumes a `HTLCUtxo` with the `Claim` redeemer, providing the preimage of the stored hash. This transaction must be submited before the timeout, signed by the receiver and create the desired_output.

![Claim funds from HTLC](tx_claim_htlc.svg)


## Ah-hoc ledger `verify-perform` mechanism PoC

The main challenge is to assess the feasibility of the mechanism by implementing a first version.

We'll implement the mechanism as part of a script that UTxOs from the involved L2s will interact with. The script will be used to `verify` and `perform` the transactions across the L2s.

The mechanism is comprised of the following operations:
- `wrap`: wrapping a UTxO from the L2 means to make it available in the ad-hoc ledger
- `verify`: verify a future `perform` transaction in this ledger, using wrapped UTxOs.
- `perform`: perform the already-verified transaction.
- `unwrap`: unwrap a UTxO from the ad-hoc ledger means to make it available in the L2.

### Contract Design

#### Wrapped UTxOs

L2 users will send UTxOs to the Lp script address for making them available in the ad-hoc ledger.

- Address: Lp script
- Value: any
- Datum:
  - owner: Address
  - intermediaries: List[PublicKey]

#### Reserved UTxO

The state UTxO used to store the reserved wrapped UTxOs. Its NFT will be minted by the `mint` purpose of the Lp script.

- Address: Lp script
- Value: 1 NFT
- Datum:
  - reserved_utxos: Map[TransactionHash, List[OutputRef]]

#### Lₚ script

- Spend purpose redeemers:
  - Verify
  - Perform
  - Unwrap

- Mint purpose redeemers:
  - Data: for minting the Reserved UTxOs

- No other purposes allowed

#### Operations overview

The `wrap` operation will not be on-chain validated for a first implementation version. It will just boil down to simply paying a UTxO with a well-formed datum to the script address.

![Wrap UTxOs](tx_wrap_utxos.svg)

The `verify` operation will mark the wrapped UTxOs as **reserved** for a specific `perform` transaction, and also disallow the usage for other `verify` operations. The marked UTxOs list will be stored in the datum of a unique "state UTxO" for the ad-hoc ledger. By off-chain mechanisms, the wrapped UTxOs will be tagged with the `perform` transaction hash, and a set of privileged participants will cosign the transaction as a way to guarantee some level of security for the mechanism.

![Verify](tx_verify.svg)

The `perform` operation will consume their reserved wrapped UTxOs, and validate its hash against the tag of those UTxOs.

![Perform](tx_perform.svg)

The `unwrap` operation will unwrap the UTxOs from the ad-hoc ledger and make them available in the L2.

The operation for creating the _reserved UTxOs_ state UTxO will be on the validator's `mint` purpose.

As stated in the `verify-perform` mechanism description for ms1 deliverable, each L2s replica of the ad-hoc ledger must be semantically equivallent i.e. same UTxO set except their addresses, for ensuring no liquidity traps. This consistency, along with the correct ordering of the operations for atomicity, is ensured by the intermediaries cosigning the `verify` and `perform` transactions in each L2 replica.
