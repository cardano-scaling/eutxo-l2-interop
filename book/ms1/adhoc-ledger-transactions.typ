// ad-hoc ledger transactions for cross-l2 htlc payments

#import "../lib/transaction.typ": *

#set page(
  height: auto,
)

// for sender in head A, for intermediaries in head B
#let tx_wrap_utxo = vanilla_transaction(
  "Head A/B - Wrap UTxO",
  inputs: (
    (
      name: "User Input",
      value: (
        ADA: "N",
      ),
    ),
  ),
  outputs: (
    (
      name: "Wrapped UTxO",
      address: "Lₚ script",
      value: (ADA: "N"),
      datum: (
        owner: [Address],
        nonce: [Integer],
        intermediaries: [List[PublicKey]],
        perform_body_hash: [Optional[Hash]],
        extension: [Data],
      ),
    ),
  ),
)

// for sender in head A, intermediaries in head B
#let tx_htlc_verify_lock = transaction(
  "Head A/B - HTLC Verify Lock",
  inputs: (
    (
      name: "Wrapped UTxO",
      address: "Lₚ script",
      value: (
        ADA: "N",
      ),
      datum: (
        owner: [Address],
        nonce: [Integer],
        intermediaries: [List[PublicKey]],
        perform_body_hash: [Optional[Hash]],
        extension: [Data],
      ),
    ),
  ),
  outputs: (
    (
      name: "Wrapped UTxO",
      address: "Lₚ script",
      value: (
        ADA: "N",
        validity_proof: "1",
      ),
      datum: (
        owner: [Address],
        nonce: [Integer],
        intermediaries: [List[PublicKey]],
        perform_body_hash: [Hash],
        extension: [Data],
      ),
    ),
  ),
)

#let tx_htlc_perform_lock = transaction(
  "Head A/B - HTLC Perform Lock",
  inputs: (
    (
      name: "Wrapped UTxO",
      address: "Lₚ script",
      value: (
        ADA: "N",
        validity_proof: "1",
      ),
      datum: (
        owner: [Address],
        nonce: [Integer],
        intermediaries: [List[PublicKey]],
        perform_body_hash: [Hash],
        extension: [Data]
      ),
    ),
  ),
  outputs: (
    (
      name: "HTLC",
      address: "Lₚ script",
      value: (ADA: "N"),
      datum: (
        owner: [Address],
        nonce: [Integer],
        intermediaries: [List[PublicKey]],
        perform_body_hash: [Hash],
        extension: [HtlcDatum],
      ),
    ),
  ),
)

#let export = sys.inputs.export

#(
  if export == "wrap" {
    tx_wrap_utxo
  } else if export == "verify_lock" {
    tx_htlc_verify_lock
  } else if export == "perform_lock" {
    tx_htlc_perform_lock
  } else {
    [Unknown export target: #export]
  }
)

