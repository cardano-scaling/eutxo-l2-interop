use cardano/transaction.{Transaction, Output, OutputReference}
use aiken/crypto.{VerificationKeyHash}

pub type WrappedDatum {
  owner: VerificationKeyHash,
  intermediaries: List<VerificationKeyHash>,
}

pub type WrappedRedeemer {
  UnWrap
  Verify
}

validator wrapped() {
  spend(
    datum_opt: Option<WrappedDatum>,
    redeemer: WrappedRedeemer,
    own_input_ref: OutputReference,
    tx: Transaction,
  ) {
    // TODO: 
    // - if unwrapping, check for owner signature
    // - if verifying:
    //   - check for owner and intermediaries signatures
    //   - what else?
    True
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
    // - if reversing, check outputs with datum.inputs
    // - if performing, check outputs with datum.outputs
    True
  }
}
