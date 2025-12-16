use aiken/collection/list
use aiken/interval.{is_entirely_after}
use cardano/transaction.{OutputReference, Transaction}

pub type VestingDatum {
  vest_after: Int,
  receiver: ByteArray,
}

fn signed_by(tx: Transaction, pkh: ByteArray) -> Bool {
  list.has(tx.extra_signatories, pkh)
}

validator vesting {
  spend(
    datum_opt: Option<VestingDatum>,
    _redeemer: Data,
    _input: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt
    and {
      is_entirely_after(tx.validity_range, datum.vest_after)?,
      signed_by(tx, datum.receiver)?,
    }
  }

  else(_) {
    fail
  }
}
