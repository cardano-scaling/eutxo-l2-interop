use cardano/address.{from_verification_key}
use cardano/assets.{from_lovelace}
use cardano/transaction.{Transaction, OutputReference, Output, InlineDatum}
use aiken/crypto.{VerificationKeyHash}
use aiken/collection/list

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

// Helper function to check if a VKH is in intermediaries list
fn is_intermediate(vkh: VerificationKeyHash, intermediaries: Pairs<VerificationKeyHash, Int>) -> Bool {
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

    let Transaction { extra_signatories, .. } = tx

    when redeemer is {
      Unwrap -> {
        // Owner must sign to unwrap funds
        list.has(extra_signatories, datum.owner)?
      }
      Dispute -> {
        // Validate signer is owner OR intermediary
        let is_owner_signed = list.has(extra_signatories, datum.owner)?
        let is_intermediate_signed = list.any(extra_signatories, fn(signer) {
          is_intermediate(signer, datum.intermediaries)?
        })?

        let valid_signer = is_owner_signed || is_intermediate_signed?

        // Get own input for comparison
        expect Some(own_input) = list.find(tx.inputs, fn(input) {
          input.output_reference == own_input_ref
        })

        // Use first output as continuing output
        expect [continuing_output, ..] = tx.outputs

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
        // TODO: Verify implementation for future
        True
      }
      // TODO: Add replica index in the redeemer
      Merge -> {
        // Get own input for comparison
        expect Some(own_input) = list.find(tx.inputs, fn(input) {
          input.output_reference == own_input_ref
        })

        // Validate UTxO is disputed
        expect datum.disputed == True

        // Find replica input (must have same nonce)
        let replica_input = list.find(tx.inputs, fn(input) {
          input.output_reference != own_input_ref &&
          input.output.address == own_input.output.address &&
          when input.output.datum is {
            InlineDatum(replica_datum) -> {
              if replica_datum is WrappedDatum {
                replica_datum.nonce == datum.nonce
              } else {
                False
              }
            }
            _ -> False
          }
        })

        // Ensure replica exists and is disputed
        expect Some(replica) = replica_input
        expect InlineDatum(replica_inline_datum) = replica.output.datum
        expect replica_datum: WrappedDatum = replica_inline_datum
        expect replica_datum.disputed == True

        // Validate outputs structure
        expect [unwrap_output, ..rest] = tx.outputs

        and {
          // Validate unwrap output sends to owner
          unwrap_output.address == from_verification_key(datum.owner),
          unwrap_output.value == own_input.output.value,

          // Validate intermediary outputs
          // - must be immediately after the unwrap_output
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
            }
          ),
        }
      }
      Punish -> {
        // TODO: checks:
        // - timeout expired
        // - signed by owner
        // (no need to check payments, owner takes all, even collaterals)
        True
      }
    }
  }
}

pub type WrappedOutput {
  datum: WrappedDatum,
  lovelace: Int,
}

pub type VerifiedDatum {
  // inputs of the verified tx, used to revert
  inputs: List<WrappedOutput>,
  // ouputs of the verified tx, used to perform
  outputs: List<WrappedOutput>,
}

pub type VerifiedRedeemer {
  Revert
  Perform
}

validator verified() {
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
}
