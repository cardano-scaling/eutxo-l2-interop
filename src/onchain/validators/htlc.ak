use aiken/builtin.{blake2b_256}
use aiken/collection/list
use aiken/interval.{is_entirely_after, is_entirely_before}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId, from_asset_list}
use cardano/transaction.{
  InlineDatum, NoDatum, Output, OutputReference, Transaction,
}

pub type HtlcOutput {
  address: Address,
  value: Pairs<PolicyId, Pairs<AssetName, Int>>,
  datum: Option<Data>,
}

pub type HtlcDatum {
  hash: ByteArray,
  timeout: Int,
  sender: ByteArray,
  receiver: ByteArray,
  desired_output: HtlcOutput,
}

pub type Redeemer {
  Claim(ByteArray)
  Refund
}

pub fn check_desired_output(
  desired_htlc_output: HtlcOutput,
  outputs: List<Output>,
) {
  list.any(
    outputs,
    fn(o) {
      let correct_datum =
        when desired_htlc_output.datum is {
          Some(desired_datum) -> o.datum == InlineDatum(desired_datum)
          None -> o.datum == NoDatum
        }

      and {
        (o.address == desired_htlc_output.address)?,
        correct_datum?,
        (o.value == from_asset_list(desired_htlc_output.value))?,
      }
    },
  )
}

validator htlc {
  spend(
    datum_opt: Option<HtlcDatum>,
    redeemer: Redeemer,
    _input: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt

    let Transaction { outputs, validity_range, extra_signatories, .. } = tx

    let HtlcDatum { hash, timeout, sender, receiver, desired_output } = datum

    when redeemer is {
      Claim(preimage) -> and {
          // Preimage matches hash
          (blake2b_256(preimage) == hash)?,
          // HTLC is not expired
          is_entirely_before(validity_range, timeout)?,
          // Receiver is signing
          list.has(extra_signatories, receiver)?,
          // Desired output is created
          check_desired_output(desired_output, outputs)?,
        }

      Refund -> and {
          // HTLC is expired
          is_entirely_after(validity_range, timeout)?,
          // Sender is signing
          list.has(extra_signatories, sender)?,
        }
    }
  }

  else(_) {
    fail
  }
}
