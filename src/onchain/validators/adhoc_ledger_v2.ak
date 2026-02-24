use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Script}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{
  InlineDatum, Output, OutputReference, Transaction, find_input,
}

pub type LpDatum {
  owner: VerificationKeyHash,
  intermediaries: List<VerificationKeyHash>,
}

pub type LpSpendRedeemer {
  Verify
  Perform
}

pub type LpMintRedeemer {
  MintVerified
  BurnVerified
}

const verified_token_name: ByteArray = ""

validator lp_v2 {
  spend(
    _datum_opt: Option<LpDatum>,
    redeemer: LpSpendRedeemer,
    own_input_ref: OutputReference,
    tx: Transaction,
  ) {
    let Transaction { inputs, mint, extra_signatories, .. } = tx

    expect Some(own_input) = find_input(inputs, own_input_ref)
    expect Script(script_hash) = own_input.output.address.payment_credential

    when redeemer is {
      Verify ->
        // TODO verify logic when the tx inputs to be spent in a perform tx that belong to this script
        True
      Perform -> {
        // all verified tokens present in the inputs must be burnt
        let
          verified_tokens_in_inputs_count,
          required_signatories,
        <-
          list.foldl2(
            inputs,
            0,
            [],
            fn(
              input,
              verified_tokens_in_inputs_count,
              required_signatories,
              return,
            ) {
              if input.output.address.payment_credential == Script(script_hash) {
                expect InlineDatum(datum) = input.output.datum
                expect LpDatum { intermediaries, owner } = datum
                return(
                  verified_tokens_in_inputs_count + 1,
                  required_signatories
                    |> list.concat(intermediaries)
                    |> list.push(owner),
                )
              } else {
                return(verified_tokens_in_inputs_count, required_signatories)
              }
            },
          )
        expect
          quantity_of(mint, script_hash, verified_token_name) == -verified_tokens_in_inputs_count
        // intermediaries and owners must be in the signatories
        expect extra_signatories == required_signatories
        // ENHACEMENTS: incrementally add validations over the outputs. first version: blind trust on the intermediaries and owners
        True
      }
    }
  }

  mint(redeemer: LpMintRedeemer, policy_id: PolicyId, tx: Transaction) {
    when redeemer is {
      MintVerified -> {
        let Transaction { mint, outputs, extra_signatories, .. } = tx
        // positive minting of verified tokens
        let minted_quantity = quantity_of(mint, policy_id, verified_token_name)
        expect minted_quantity > 0
        // all verified tokens must belong to own script outputs
        let
          own_script_outputs_token_count,
          required_signatories,
        <-
          list.foldl2(
            outputs,
            0,
            [],
            fn(
              output: Output,
              own_script_outputs_token_count,
              required_signatories,
              return,
            ) {
              if output.address.payment_credential == Script(policy_id) {
                // each own output must have one token
                expect
                  quantity_of(output.value, policy_id, verified_token_name) == 1
                // and must have well formed datum
                expect InlineDatum(datum) = output.datum
                expect LpDatum { intermediaries, .. } = datum
                return(
                  own_script_outputs_token_count + 1,
                  required_signatories |> list.concat(intermediaries),
                )
              } else {
                return(own_script_outputs_token_count, required_signatories)
              }
            },
          )
        expect minted_quantity == own_script_outputs_token_count
        expect extra_signatories == required_signatories
        True
      }
      BurnVerified -> True
    }
  }

  else(_) {
    fail
  }
}
