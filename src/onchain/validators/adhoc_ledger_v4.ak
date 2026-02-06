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
      Merge -> {
        // TODO: only possible in L1, checks:
        // - UTxO is disputed
        // - the replica is also consumed and disputed
        // - first output is the unwrapped UTxO
        // - following outputs are the intermediaries collaterals
        True
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
