use cardano/transaction.{Output,  OutputReference, Transaction, InlineDatum}
use cardano/assets.{PolicyId, quantity_of}
use cardano/address.{Script}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}

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
    _own_input_ref: OutputReference,
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
    redeemer: LpMintRedeemer,
    policy_id: PolicyId,
    tx: Transaction,
  ) {
    when redeemer is {
      MintVerified -> {
        let Transaction { mint, outputs, extra_signatories, .. } = tx
        // positive minting of verified tokens
        let minted_quantity = quantity_of(mint, policy_id, verified_token_name)
        expect minted_quantity > 0
        // all verified tokens must belong to own script outputs
        let own_script_outputs_token_count, required_signatories <-
          list.foldl2(
            outputs,
            0,
            [],
            fn (output: Output, own_script_outputs_token_count, required_signatories, return) {
              if (output.address.payment_credential == Script(policy_id)) {
                // each own output must have one token
                expect quantity_of(output.value, policy_id, verified_token_name) == 1
                // and must have well formed datum
                expect InlineDatum(datum) = output.datum
                expect LpDatum { intermediaries, .. } = datum
                return(
                  own_script_outputs_token_count + 1,
                  required_signatories |> list.concat(intermediaries),
                )
              } else {
                return(
                  own_script_outputs_token_count,
                  required_signatories,
                )
              }
            })
        expect minted_quantity == own_script_outputs_token_count
        expect extra_signatories == required_signatories
        True
      }
      BurnVerified ->
        True
    }
  }
}
