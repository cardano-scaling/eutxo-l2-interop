use cardano/transaction.{OutputReference, Transaction, Redeemer, TransactionId}
use aiken/collection/dict.{Dict}

pub type WrappedDatum {
  owner: ByteArray,
  intermediaries: List<ByteArray>,
}

pub type LpRedeemer {
  Verify
  Perform
}

pub type ReservedDatum {
  // transaction hash of the expected perform -> output references of the wrapped utxos
  reserved_utxos: Dict<TransactionId, List<OutputReference>>,
}

validator lp {
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
    _policy_id: ByteArray,
    _tx: Transaction,
  ) {
    // mint the nft of the reserved utxo
    True
  }

  else(_) {
    fail
  }
}
