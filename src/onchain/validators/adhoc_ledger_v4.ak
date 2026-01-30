use cardano/transaction.{Transaction, OutputReference}
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
      Dispute -> {
        // TODO: checks:
        // - signed by any party (owner or intermediary)
        // - continuing output is equal to spent input but 
        //   disputed is True
        True
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
