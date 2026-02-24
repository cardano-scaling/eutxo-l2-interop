use aiken/collection/list
use aiken/collection/pairs.{keys}
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{is_entirely_after}
use cardano/address.{Address, from_verification_key}
use cardano/assets.{AssetName, PolicyId, from_lovelace}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}

pub type WrappedDatum {
  owner: VerificationKeyHash,
  intermediaries: Pairs<VerificationKeyHash, Int>,
  nonce: OutputReference,
  disputed: Bool,
  timeout: Option<Int>,
}

pub type WrappedRedeemer {
  Unwrap
  Verify
  Dispute
  Merge
  Punish
}

pub type DesiredOutput {
  address: Address,
  value: Pairs<PolicyId, Pairs<AssetName, Int>>,
  datum: Option<Data>,
}

// Helper function to check if a VKH is in intermediaries list
fn is_intermediate(
  vkh: VerificationKeyHash,
  intermediaries: Pairs<VerificationKeyHash, Int>,
) -> Bool {
  list.any(intermediaries, fn(pair) { pair.1st == vkh })
}

validator wrapped {
  spend(
    datum_opt: Option<WrappedDatum>,
    redeemer: WrappedRedeemer,
    own_input_ref: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt

    let Transaction { extra_signatories, validity_range, inputs, outputs, .. } =
      tx

    when redeemer is {
      Unwrap ->
        // Owner must sign to unwrap funds
        list.has(extra_signatories, datum.owner)?
      Dispute -> {
        // Validate signer is owner OR intermediary
        let is_owner_signed = list.has(extra_signatories, datum.owner)?
        let is_intermediate_signed =
          list.any(
            extra_signatories,
            fn(signer) { is_intermediate(signer, datum.intermediaries)? },
          )?

        let valid_signer = is_owner_signed || is_intermediate_signed?

        // Get own input for comparison
        expect Some(own_input) =
          list.find(
            inputs,
            fn(input) { input.output_reference == own_input_ref },
          )

        // Use first output as continuing output
        expect [continuing_output, ..] = outputs

        // Extract inline datum from continuing output
        expect InlineDatum(continuing_datum) = continuing_output.datum
        expect continuing_datum: WrappedDatum = continuing_datum

        // Validate state transition
        and {
          // Authorization checks
          valid_signer,
          // Datum field preservation
          continuing_datum.owner == datum.owner,
          continuing_datum.intermediaries == datum.intermediaries,
          continuing_datum.nonce == datum.nonce,
          // Required state changes
          continuing_datum.disputed == True,
          when continuing_datum.timeout is {
            Some(_) -> True
            None -> False
          },
          // Value preservation
          continuing_output.value == own_input.output.value,
          // Address preservation
          continuing_output.address == own_input.output.address,
        }
      }
      Verify -> {
        expect Some(own_input) =
          list.find(
            inputs,
            fn(input) { input.output_reference == own_input_ref },
          )

        expect InlineDatum(i_datum) = own_input.output.datum
        // Must not be disputed
        expect WrappedDatum { intermediaries, disputed: False, .. } = i_datum

        // Signed by intermediaries in self inputs
        list.difference(keys(intermediaries), extra_signatories) == []
      }

      // TODO: Add replica index in the redeemer
      Merge -> {
        // Get own input for comparison
        expect Some(own_input) =
          list.find(
            inputs,
            fn(input) { input.output_reference == own_input_ref },
          )

        // Validate UTxO is disputed
        expect datum.disputed == True

        // Find replica input (must have same nonce)
        let replica_input =
          list.find(
            inputs,
            fn(input) {
              input.output_reference != own_input_ref && input.output.address == own_input.output.address && when
                input.output.datum
              is {
                InlineDatum(replica_datum) ->
                  if replica_datum is WrappedDatum {
                    replica_datum.nonce == datum.nonce
                  } else {
                    False
                  }
                _ -> False
              }
            },
          )

        // Ensure replica exists and is disputed
        expect Some(replica) = replica_input
        expect InlineDatum(replica_inline_datum) = replica.output.datum
        expect replica_datum: WrappedDatum = replica_inline_datum
        expect replica_datum.disputed == True

        // Validate outputs structure
        expect [unwrap_output, ..rest] = outputs

        and {
          // Validate unwrap output sends to owner
          unwrap_output.address == from_verification_key(datum.owner),
          unwrap_output.value == own_input.output.value,
          // Validate intermediary outputs
          // - one output for each element of intermediaries
          // - for each output, address must be equal to 1st elemento of pair, lovelace value must be equal to 2nd
          list.all(
            list.zip(rest, datum.intermediaries),
            fn((output, intermediary)) {
              let Pair(vkh, lovelace) = intermediary
              and {
                output.address == from_verification_key(vkh),
                output.value == from_lovelace(lovelace),
              }
            },
          ),
        }
      }
      Punish -> {
        // Checks:
        // - UTxO is disputed
        // - timeout expired
        // - signed by owner
        // (no need to check payments, owner takes all, even collaterals)

        expect WrappedDatum {
          owner,
          timeout: Some(timeout),
          disputed: True,
          ..
        } = datum

        and {
          is_entirely_after(validity_range, timeout),
          list.any(extra_signatories, fn(signer) { signer == owner }),
        }
      }
    }
  }

  else(_) {
    fail
  }
}

pub type VerifiedDatum {
  // inputs of the verified tx, used to revert
  inputs: List<DesiredOutput>,
  // ouputs of the verified tx, used to perform
  outputs: List<DesiredOutput>,
}

pub type VerifiedRedeemer {
  Revert
  Perform
}

validator verified {
  spend(
    datum_opt: Option<VerifiedDatum>,
    redeemer: VerifiedRedeemer,
    own_input_ref: OutputReference,
    tx: Transaction,
  ) {
    // TODO:
    // - if reversing, check:
    //   - must by signed by the owner of one of the inputs
    //   - outputs must be like datum.inputs
    // - if performing, check outputs with datum.outputs
    True
  }

  else(_) {
    fail
  }
}
