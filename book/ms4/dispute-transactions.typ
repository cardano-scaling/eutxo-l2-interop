// ad-hoc ledger v4 dispute mechanism transactions

#import "../lib/transaction.typ": *

#set page(
  height: auto,
)

#let tx_wrap_v4 = transaction(
  "Wrap UTxO",
  inputs: (
    (
      name: "User UTxO",
      address: "User address",
      value: (
        ADA: "N",
      ),
    ),
  ),
  outputs: (
    (
      name: "Wrapped UTxO",
      address: "Wrapped script",
      value: (
        ADA: "N",
      ),
      datum: (
        owner: [VerificationKeyHash],
        intermediaries: [Pairs\<VKH, Int\>],
        nonce: [OutputReference],
        disputed: [False],
        timeout: [None],
      ),
    ),
  ),
)

#let tx_unwrap_v4 = vanilla_transaction(
  "Unwrap UTxO",
  inputs: (
    (
      name: "Wrapped UTxO",
      address: "Wrapped script",
      value: (
        ADA: "N",
      ),
      datum: (
        owner: [VKH],
        intermediaries: [Pairs\<VKH, Int\>],
        nonce: [OutputReference],
        disputed: [False],
        timeout: [None],
      ),
      redeemer: "Unwrap",
    ),
  ),
  outputs: (
    (
      name: "Owner Output",
      address: "Owner address",
      value: (
        ADA: "N",
      ),
    ),
  ),
  signatures: (
    "owner",
  ),
)

#let tx_dispute_v4 = vanilla_transaction(
  "Dispute",
  inputs: (
    (
      name: "Wrapped UTxO",
      address: "Wrapped script",
      value: (
        ADA: "N",
      ),
      datum: (
        owner: [VKH],
        intermediaries: [Pairs\<VKH, Int\>],
        nonce: [OutputReference],
        disputed: [False],
        timeout: [None],
      ),
      redeemer: "Dispute",
    ),
  ),
  outputs: (
    (
      name: "Disputed UTxO",
      address: "Wrapped script",
      value: (
        ADA: "N",
      ),
      datum: (
        owner: [VKH],
        intermediaries: [Pairs\<VKH, Int\>],
        nonce: [OutputReference],
        disputed: [*True*],
        timeout: [*Some(T)*],
      ),
    ),
  ),
  signatures: (
    "owner OR intermediary",
  ),
)

#let tx_merge_v4 = vanilla_transaction(
  "Merge",
  inputs: (
    (
      name: "Disputed UTxO (R₀)",
      address: "Wrapped script",
      value: (
        ADA: "N",
      ),
      datum: (
        owner: [Alice_vkh],
        nonce: [N],
        disputed: [True],
      ),
      redeemer: "Merge",
    ),
    (
      name: "Disputed UTxO (R₁)",
      address: "Wrapped script",
      value: (
        ADA: "N",
      ),
      datum: (
        owner: [Alice_vkh],
        nonce: [N],
        disputed: [True],
      ),
      redeemer: "Merge",
    ),
  ),
  outputs: (
    (
      name: "Owner Output",
      address: "Alice address",
      value: (
        ADA: "N",
      ),
    ),
    (
      name: "Intermediary Output",
      address: "Ida address",
      value: (
        ADA: "N",
      ),
    ),
  ),
  notes: [
    #v(0.5pt)
    Runs on L1 after head fanout.
  ],
)

#let tx_punish_v4 = vanilla_transaction(
  "Punish",
  inputs: (
    (
      name: "Disputed UTxO",
      address: "Wrapped script",
      value: (
        ADA: "N",
      ),
      datum: (
        owner: [VKH],
        disputed: [True],
        timeout: [Some(T)],
      ),
      redeemer: "Punish",
    ),
  ),
  outputs: (
    (
      name: "Owner Output",
      address: "Owner address",
      value: (
        ADA: "N",
      ),
    ),
  ),
  signatures: (
    "owner",
  ),
  validRange: (
    lower: "T",
  ),
)

#let tx_verify_v4 = vanilla_transaction(
  "Verify",
  inputs: (
    (
      name: "Wrapped UTxO₁",
      address: "Wrapped script",
      value: (
        "": "V₁",
      ),
      datum: (
        owner: [VKH₁],
        intermediaries: [Pairs\<VKH, Int\>],
        nonce: [OutputReference₁],
        disputed: [False],
        timeout: [None],
      ),
      redeemer: "Verify",
    ),
    (dots: ""),
    (
      name: "Wrapped UTxOₙ",
      address: "Wrapped script",
      value: (
        "": "Vₙ",
      ),
      datum: (
        owner: [VKHₙ],
        intermediaries: [Pairs\<VKH, Int\>],
        nonce: [OutputReferenceₙ],
        disputed: [False],
        timeout: [None],
      ),
      redeemer: "Verify",
    ),
  ),
  outputs: (
    (
      name: "Verified UTxO",
      address: "Verified script",
      value: (
        "": "V",
      ),
      datum: (
        inputs: [List\<WrappedOutput\>],
        outputs: [List\<WrappedOutput\>],
      ),
    ),
  ),
  signatures: (
    "intermediary",
  ),
  notes: [
    $
      V = sum_n V_i
    $
  ]
)

#let tx_revert_v4 = vanilla_transaction(
  "Revert",
  inputs: (
    (
      name: "Verified UTxO",
      address: "Verified script",
      value: (
        "": "V",
      ),
      datum: (
        inputs: [List\<WrappedOutput\>],
        outputs: [List\<WrappedOutput\>],
      ),
      redeemer: "Revert",
    ),
  ),
  outputs: (
    (
      name: "Wrapped UTxO₁",
      address: "Wrapped script",
      value: (
        "": "V₁",
      ),
      datum: (
        owner: [VKH₁],
        intermediaries: [Pairs\<VKH, Int\>],
        nonce: [OutputReference₁],
        disputed: [False],
        timeout: [None],
      ),
    ),
    (dots: ""),
    (
      name: "Wrapped UTxOₙ",
      address: "Wrapped script",
      value: (
        "": "Vₙ",
      ),
      datum: (
        owner: [VKHₙ],
        intermediaries: [Pairs\<VKH, Int\>],
        nonce: [OutputReferenceₙ],
        disputed: [False],
        timeout: [None],
      ),
    ),
  ),
  signatures: (
    "owner",
  ),
  notes: [
    $
      V = sum_n V_i
    $
  ]
)

#let tx_perform_v4 = vanilla_transaction(
  "Perform",
  inputs: (
    (
      name: "Verified UTxO",
      address: "Verified script",
      value: (
        "": "V",
      ),
      datum: (
        inputs: [List\<WrappedOutput\>],
        outputs: [List\<WrappedOutput\>],
      ),
      redeemer: "Perform",
    ),
  ),
  outputs: (
    (
      name: "Wrapped UTxO₁",
      address: "Wrapped script",
      value: (
        "": "V₁",
      ),
      datum: (
        owner: [VKH₁],
        intermediaries: [Pairs\<VKH, Int\>],
        nonce: [OutputReference₁],
        disputed: [False],
        timeout: [None],
      ),
    ),
    (dots: ""),
    (
      name: "Wrapped UTxOₙ",
      address: "Wrapped script",
      value: (
        "": "Vₙ",
      ),
      datum: (
        owner: [VKHₙ],
        intermediaries: [Pairs\<VKH, Int\>],
        nonce: [OutputReferenceₙ],
        disputed: [False],
        timeout: [None],
      ),
    ),
  ),
  signatures: (
    "intermediary",
  ),
  notes: [
    $ V = sum_n V_i$
  ]
)

#let export = sys.inputs.export

#(
  if export == "wrap" {
    tx_wrap_v4
  } else if export == "unwrap" {
    tx_unwrap_v4
  } else if export == "dispute" {
    tx_dispute_v4
  } else if export == "merge" {
    tx_merge_v4
  } else if export == "punish" {
    tx_punish_v4
  } else if export == "verify" {
    tx_verify_v4
  } else if export == "revert" {
    tx_revert_v4
  } else if export == "perform" {
    tx_perform_v4
  } else {
    [Unknown export target: #export]
  }
)
