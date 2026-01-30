use cardano/transaction.{Transaction, OutputReference}
use aiken/crypto.{VerificationKeyHash}
use aiken/collection/list

pub type WrappedDatum {
  owner: VerificationKeyHash,
  intermediaries: List<VerificationKeyHash>,
}

pub type WrappedRedeemer {
  Unwrap
  Verify
}

validator wrapped() {
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
      Verify -> {
        // TODO: Verify implementation for future
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
