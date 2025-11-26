use cardano/transaction.{OutputReference, Transaction, Redeemer, TransactionId, InlineDatum, find_input}
use cardano/assets.{PolicyId, quantity_of}
use cardano/address.{Script}
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}

pub type WrappedDatum {
  owner: VerificationKeyHash,
  intermediaries: List<VerificationKeyHash>,
}

pub type LpRedeemer {
  Verify { perform_tx_hash: TransactionId }
  Perform
}

pub type ReservedDatum {
  // transaction hash of the expected perform -> output references of the wrapped utxos
  reserved_utxos: Pairs<TransactionId, List<OutputReference>>,
}

const reserved_utxo_nft_name: ByteArray = ""

validator lp(seed: OutputReference) {
  spend(
    datum_opt: Option<ReservedDatum>,
    redeemer: LpRedeemer,
    own_input_ref: OutputReference,
    tx: Transaction,
  ) {
    when redeemer is {
      Verify { perform_tx_hash } -> {
        let Transaction { inputs, reference_inputs, outputs, extra_signatories, .. } = tx
        // look for own input and output
        expect Some(own_input) = find_input(inputs, own_input_ref)
        expect Script(script_hash) = own_input.output.address.payment_credential
        expect Some(own_output) = outputs |> list.find(fn (o) {
          quantity_of(o.value, script_hash, reserved_utxo_nft_name) == 1
        })
        // forbid own script inputs other than the reserved utxo input
        expect inputs
          |> list.filter(fn (i) {
            expect InlineDatum(datum) = i.output.datum
            Script(script_hash) == i.output.address.payment_credential
            && if datum is ReservedDatum { False } else { True }
          })
          |> list.is_empty()

        // collect all wrapped utxos from reference inputs
        let wrapped_utxos = reference_inputs
          |> list.filter(fn (i) {
            expect InlineDatum(datum) = i.output.datum
            Script(script_hash) == i.output.address.payment_credential
            && if datum is WrappedDatum { True } else { False }
          })

        // update reserved utxo datum: perform tx hash -> output references mapping
        expect Some(input_datum) = datum_opt
        let ReservedDatum {
          reserved_utxos: prev_reserved_utxos_pairs
        } = input_datum
        let expected_reserved_utxos = dict.from_pairs(prev_reserved_utxos_pairs)
          |> dict.insert(
            perform_tx_hash,
            wrapped_utxos |> list.map(fn (u) { u.output_reference })
          )
          |> dict.to_pairs()
        expect InlineDatum(output_datum) = own_output.datum
        expect ReservedDatum {
          reserved_utxos: new_reserved_utxos
        } = output_datum
        expect new_reserved_utxos == expected_reserved_utxos

        // signatories check: all intermediaries + wrapped utxo owners must sign this transaction
        let expected_signatories = wrapped_utxos
          |> list.foldl(
            dict.empty,
            fn (u, acc) {
              expect InlineDatum(datum) = u.output.datum
              expect WrappedDatum { owner, intermediaries } = datum
              // using the dict as a set, so just the keys are important, the values (0) are dummy!
              let result = acc |> dict.insert(owner, 0)
              intermediaries |> list.foldl(
                result,
                fn (intermediary, acc2) { acc2 |> dict.insert(intermediary, 0) }
              )
            })
            |> dict.keys()
        expect extra_signatories == expected_signatories

        True
      }
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
    expect reserved_utxos |> list.is_empty()

    True
  }

  else(_) {
    fail
  }
}
