use cardano/transaction.{OutputReference, Transaction, Redeemer, TransactionId, InlineDatum, find_input}
use cardano/assets.{PolicyId, quantity_of}
use cardano/address.{Script, Credential}
use aiken/collection/dict.{Dict}
use aiken/collection/list

pub type WrappedDatum {
  owner: Credential,
  intermediaries: List<Credential>,
}

pub type LpRedeemer {
  Verify
  Perform
}

pub type ReservedDatum {
  // transaction hash of the expected perform -> output references of the wrapped utxos
  reserved_utxos: Dict<TransactionId, List<OutputReference>>,
}

const reserved_utxo_nft_name: ByteArray = ""

validator lp(seed: OutputReference) {
  spend(
    _datum_opt: Option<WrappedDatum>,
    redeemer: LpRedeemer,
    _input: OutputReference,
    _tx: Transaction,
  ) {
    when redeemer is {
      Verify ->
        True
      Perform ->
        True
    }
  }

  mint(
    _redeemer: Redeemer,
    policy_id: PolicyId,
    tx: Transaction,
  ) {
    let Transaction { inputs, mint, outputs, .. } = tx
    // must spend the seed utxo, ensuring uniqueness
    expect Some(_) = find_input(inputs, seed)
    // must mint the nft
    expect quantity_of(mint, policy_id, reserved_utxo_nft_name) == 1
    // the nft must be paid to own script address
    expect Some(output) = outputs
      |> list.find(fn (o) {
        quantity_of(o.value, policy_id, reserved_utxo_nft_name) == 1
      })
    expect output.address.payment_credential == Script(policy_id)
    // the own script output must have the correct initial datum
    expect InlineDatum(datum) = output.datum
    expect ReservedDatum { reserved_utxos } = datum
    expect reserved_utxos |> dict.is_empty()

    True
  }

  else(_) {
    fail
  }
}
