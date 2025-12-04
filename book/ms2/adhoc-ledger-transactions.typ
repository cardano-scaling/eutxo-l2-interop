// ad-hoc ledger transactions for cross-l2 htlc payments

#import "../lib/transaction.typ": *

#set page(
  height: auto,
)

#let tx_verify_v1 = vanilla_transaction(
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

#let tx_perform_v1 = vanilla_transaction(
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

#let tx_verify_v2 = vanilla_transaction(
  "Verify - Wrap UTxO",
  inputs: (
    (
      name: "User UTxO",
      address: "User address",
      value: (
        ADA: "N",
        native_assets: "X",
      ),
    ),
  ),
  outputs: (
    (
      name: "User Wrapped UTxO",
      address: "Lₚ script",
      value: (
        ADA: "N",
        native_assets: "X",
        validity_token: 1,
      ),
      datum: (
        owner: [Address],
        intermediaries: [List[PublicKey]],
      ),
    ),
  ),
  mint: (
    "validity_token": (qty: 1, variables: (("":0))),
  ),
  signatures: (
    "intermediaries",
    "owner",
  ),
)

#let tx_perform_v2 = vanilla_transaction(
  "Perform - Wrap UTxO",
  inputs: (
    (
      name: "User Wrapped UTxO",
      address: "Lₚ script",
      value: (
        ADA: "N",
        native_assets: "X",
        validity_token: 1,
      ),
      datum: (
        owner: [Address],
        intermediaries: [List[PublicKey]],
      ),
      redeemer: "Perform",
    ),
  ),
  outputs: (
    (
      name: "User Wrapped UTxO",
      address: "Lₚ script",
      value: (
        ADA: "N",
        native_assets: "X",
      ),
      datum: (
        owner: [Address],
        intermediaries: [List[PublicKey]],
      ),
    ),
  ),
  mint: (
    "validity_token": (qty: -1, variables: (("":0))),
  ),
  signatures: (
    "intermediaries",
    "owner",
  ),
)
#let export = sys.inputs.export

#(
  if export == "wrap" {
    tx_wrap_utxos
  } else if export == "verify_v1" {
    tx_verify_v1
  } else if export == "perform_v1" {
    tx_perform_v1
  } else if export == "verify_v2" {
    tx_verify_v2
  } else if export == "perform_v2" {
    tx_perform_v2
  } else {
    [Unknown export target: #export]
  }
)

