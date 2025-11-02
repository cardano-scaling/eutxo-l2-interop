// ad-hoc ledger transactions for cross-l2 htlc payments

#import "../lib/transaction.typ": *

#set page(
  height: auto,
)

#let tx_wrap_utxos = vanilla_transaction(
  "Wrap UTxOs",
  inputs: (
    (
      name: "User Input₁",
      value: (
        ADA: "N₁",
        native_assets: "X₁",
      ),
    ),
    (dots: ""),
    (
      name: "User Inputₙ",
      value: (
        ADA: "Nₙ",
        native_assets: "Xₙ",
      ),
    ),
  ),
  outputs: (
    (
      name: "Wrapped UTxO₁",
      address: "Lₚ script",
      value: (
        ADA: "M₁",
        native_assets: "Y₁",
      ),
      datum: (
        owner: [Address],
        intermediaries: [List[PublicKey]],
      ),
    ),
    (dots: ""),
    (
      name: "Wrapped UTxOₘ",
      address: "Lₚ script",
      value: (
        ADA: "Mₘ",
        native_assets: "Yₘ",
      ),
      datum: (
        owner: [Address],
        intermediaries: [List[PublicKey]],
      ),
    ),
  ),
  notes: [
    #v(0.5pt)
    N₁ + ... + Nₙ = M₁ + ... + Mₘ,
    #v(0.5pt)
    X₁ + ... + Xₙ = Y₁ + ... + Yₘ,
  ]
)

#let tx_verify = vanilla_transaction(
  "Verify",
  inputs: (
    (
      name: "Reserved UTxO",
      address: "Lₚ script",
      value: (
        reserved_nft: 1,
      ),
      datum: (
        reserved_utxos: [Map[TxHash, List[OutputRef]]],
      ),
      redeemer: "Verify { perform_tx_hash }",
    ),
    (
      name: "Wrapped UTxO₁",
      address: "Lₚ script",
      value: (
        ADA: "N₁",
        native_assets: "X₁",
      ),
      datum: (
        "owner₁": [Address],
        intermediaries: [List[PublicKey]],
      ),
      reference: true,
    ),
    (dots: ""),
    (
      name: "Wrapped UTxOₙ",
      address: "Lₚ script",
      value: (
        ADA: "Nₙ",
        native_assets: "Xₙ",
      ),
      datum: (
        "ownerₙ": [Address],
        intermediaries: [List[PublicKey]],
      ),
      reference: true,
    ),
  ),
  outputs: (
    (
      name: "Reserved UTxO",
      address: "Lₚ script",
      value: (
        reserved_nft: 1,
      ),
      datum: (
        new_reserved_utxos: [Map[TxHash, List[OutputRef]]],
      ),
    ),
  ),
  signatures: (
    "owner₁",
    "...",
    "ownerₙ",
    "intermediaries",
  ),
  notes: [
    #v(0.5pt)
    new_reserved_utxos = reserved_utxos.add(perform_tx_hash, [output_ref(Wrapped UTxO₁), ..., output_ref(Wrapped UTxOₙ)]),
  ],
)

#let tx_perform = vanilla_transaction(
  "Perform",
  inputs: (
    (
      name: "Reserved UTxO",
      address: "Lₚ script",
      value: (
        reserved_nft: 1,
      ),
      datum: (
        reserved_utxos: [Map[TxHash, List[OutputRef]]],
      ),
      redeemer: "Perform { perform_tx_hash }",
    ),
    (
      name: "Wrapped UTxO₁",
      address: "Lₚ script",
      value: (
        ADA: "N₁",
        native_assets: "X₁",
      ),
      datum: (
        owner: [Address],
        intermediaries: [List[PublicKey]],
      ),
    ),
    (dots: ""),
    (
      name: "Wrapped UTxOₙ",
      address: "Lₚ script",
      value: (
        ADA: "Nₙ",
        native_assets: "Xₙ",
      ),
      datum: (
        owner: [Address],
        intermediaries: [List[PublicKey]],
      ),
    ),
  ),
  outputs: (
    (
      name: "Reserved UTxO",
      address: "Lₚ script",
      value: (
        reserved_nft: 1,
      ),
      datum: (
        new_reserved_utxos: [Map[TxHash, List[OutputRef]]],
      ),
    ),
    (
      name: "UTxO",
      address: "Lₚ script",
      value: (
        ADA: "N₁ + ... + Nₙ",
        native_assets: "X₁ + ... + Xₙ",
      ),
      datum: (
        owner: [Address],
        intermediaries: [List[PublicKey]],
      ),
    )
  ),
  signatures: (
    "intermediaries",
  ),
  notes: [
    #v(0.5pt)
    new_reserved_utxos = reserved_utxos.remove(perform_tx_hash),
  ],
)

#let export = sys.inputs.export

#(
  if export == "wrap" {
    tx_wrap_utxos
  } else if export == "verify" {
    tx_verify
  } else if export == "perform" {
    tx_perform
  } else {
    [Unknown export target: #export]
  }
)

