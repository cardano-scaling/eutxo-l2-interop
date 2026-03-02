use aiken/cbor
use aiken/collection/list
use aiken/collection/pairs.{get_first}
use aiken/crypto.{VerificationKeyHash, blake2b_256}
use aiken/interval.{is_entirely_after, is_entirely_before}
use cardano/address.{Address, Script}
use cardano/assets.{
  PolicyId, flatten, from_lovelace, lovelace_of, match, negate, without_lovelace,
}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Spend, Transaction,
}

pub type LotteryRedeemer {
  PayWinner(OutputReference)
  Close
}

pub type LotteryMintRedeemer {
  Mint(OutputReference)
  Burn
}

pub type LotteryDatum {
  prize: Int,
  ticket_cost: Int,
  paid_winner: Bool,
  close_timestamp: Int,
  admin: VerificationKeyHash,
}

pub type DesiredOutput {
  address: Address,
  datum: Option<Data>,
}

fn non_ada_tokens(value: assets.Value) {
  value |> without_lovelace() |> flatten()
}

validator lottery {
  spend(
    datum_opt: Option<LotteryDatum>,
    redeemer: LotteryRedeemer,
    input: OutputReference,
    tx: Transaction,
  ) {
    let Transaction {
      inputs,
      outputs,
      extra_signatories,
      validity_range,
      mint,
      ..
    } = tx

    expect Some(i_datum) = datum_opt
    let LotteryDatum {
      ticket_cost: i_d_ticket_cost,
      paid_winner: i_d_paid_winner,
      close_timestamp: i_d_close_timestamp,
      admin: i_d_admin,
      prize: i_d_prize,
    } = i_datum

    expect Some(own_input) =
      list.find(inputs, fn(i) { i.output_reference == input })

    expect Output {
      address: Address { payment_credential: Script(own_script_hash), .. },
      value: i_value,
      ..
    } = own_input.output

    // Only the control NFT in the value
    when redeemer is {
      PayWinner(winner) -> {
        expect [(pol, tn, 1)] = non_ada_tokens(i_value)

        expect [own_output] =
          list.filter(
            outputs,
            fn(o) { o.address.payment_credential == Script(own_script_hash) },
          )

        expect Output {
          value: o_value,
          datum: InlineDatum(o_datum_data),
          reference_script: None,
          ..
        } = own_output

        expect o_datum: LotteryDatum = o_datum_data

        expect Some(winner_input) =
          list.find(inputs, fn(i) { i.output_reference == winner })

        expect Output {
          value: w_i_value,
          datum: InlineDatum(w_i_datum_data),
          ..
        } = winner_input.output

        expect TicketDatum {
          lottery_id: w_i_d_lottery_id,
          desired_output: w_i_d_desired_output,
        } = w_i_datum_data

        let output_created =
          list.any(
            outputs,
            fn(o) {
              let out_datum_opt =
                when o.datum is {
                  InlineDatum(dat) -> Some(dat)
                  _ -> None
                }

              and {
                // Output address matches desired output address
                o.address == w_i_d_desired_output.address,
                // Output datum matches desired output datum
                out_datum_opt == w_i_d_desired_output.datum,
                // Output value matches lottery prize
                match(o.value, from_lovelace(i_d_prize), >=),
              }
            },
          )

        and {
          // Token is our own
          pol == own_script_hash,
          // Ticket paid the correct cost
          lovelace_of(w_i_value) >= i_d_ticket_cost,
          // Winner played our lottery
          tn == w_i_d_lottery_id,
          // Signed by Admin
          list.has(extra_signatories, i_d_admin),
          // Close timestamp has passed
          is_entirely_after(validity_range, i_d_close_timestamp),
          // Lottery token is not stolen
          match(i_value, o_value, fn(i_l, o_l) { o_l >= i_l - i_d_prize }),
          // Datum only updates paid_winner field
          LotteryDatum { ..i_datum, paid_winner: True } == o_datum,
          // Winner has not been paid yet
          i_d_paid_winner == False,
          // Desired output created
          output_created,
        }
      }
      Close -> and {
          i_d_paid_winner == True,
          // Signed by Admin
          list.has(extra_signatories, i_d_admin),
          // Token is burnt
          mint == (
            i_value
              |> without_lovelace()
              |> negate()
          ),
        }
    }
  }

  mint(redeemer: LotteryMintRedeemer, own_policy: PolicyId, tx: Transaction) {
    let Transaction {
      inputs,
      outputs,
      extra_signatories,
      validity_range,
      mint,
      ..
    } = tx

    when redeemer is {
      Mint(ref) -> {
        // Only one token is minted
        // TN == hash(redeemer)
        // qty == 1
        let expected_tn = blake2b_256(cbor.serialise(ref))

        // Paid to own script
        expect [own_output] =
          list.filter(
            outputs,
            fn(o) { o.address.payment_credential == Script(own_policy) },
          )

        expect Output {
          value: o_value,
          datum: InlineDatum(o_datum_data),
          reference_script: None,
          ..
        } = own_output

        expect LotteryDatum {
          close_timestamp: o_d_close_timestamp,
          admin: o_d_admin,
          ticket_cost: o_d_ticket_cost,
          prize: o_d_prize,
          paid_winner: False,
        }: LotteryDatum = o_datum_data

        and {
          // OutputRef from redeemer is being consumed
          list.any(inputs, fn(i) { i.output_reference == ref }),
          // Only one token is minted
          flatten(mint) == [(own_policy, expected_tn, 1)],
          // Only one token is in the output
          non_ada_tokens(o_value) == [(own_policy, expected_tn, 1)],
          // Timestamp in the future
          is_entirely_before(validity_range, o_d_close_timestamp),
          // Ticket cost and prize > 0
          o_d_ticket_cost > 0 && o_d_prize > 0,
          // Prize is covered by the output
          lovelace_of(o_value) >= o_d_prize,
          // Admin is signing the tx
          list.has(extra_signatories, o_d_admin),
        }
      }

      Burn -> {
        // Only one token is being burned
        let minted = flatten(mint)
        when minted is {
          [(policy, _, qty)] -> policy == own_policy && qty == -1
          _ -> False
        }
      }
    }
  }

  else(_) {
    fail
  }
}

pub type TicketRedeemer {
  Win
  Lose
}

pub type TicketDatum {
  lottery_id: ByteArray,
  desired_output: DesiredOutput,
}

validator ticket(lottery_script_hash: ByteArray) {
  spend(
    datum_opt: Option<TicketDatum>,
    redeemer: TicketRedeemer,
    input: OutputReference,
    tx: Transaction,
  ) {
    expect Some(datum) = datum_opt
    let Transaction {
      inputs,
      extra_signatories,
      redeemers,
      reference_inputs,
      ..
    } = tx
    let TicketDatum { lottery_id: i_d_lottery_id, .. } = datum

    when redeemer is {
      Win -> {
        // Lottery with correct token is being consumed
        expect Some(lottery_in) =
          list.find(
            inputs,
            fn(i) {
              non_ada_tokens(i.output.value) == [
                (lottery_script_hash, i_d_lottery_id, 1),
              ]
            },
          )

        expect Some(lottery_redeemer) =
          get_first(redeemers, Spend(lottery_in.output_reference))
        expect PayWinner(winner): LotteryRedeemer = lottery_redeemer

        winner == input
      }

      Lose -> {
        // Lottery with correct token is referenced
        expect Some(lottery_in) =
          list.find(
            reference_inputs,
            fn(i) {
              non_ada_tokens(i.output.value) == [
                (lottery_script_hash, i_d_lottery_id, 1),
              ]
            },
          )

        expect InlineDatum(l_datum) = lottery_in.output.datum
        expect LotteryDatum {
          admin: l_d_admin,
          paid_winner: l_d_paid_winner,
          ..
        } = l_datum

        and {
          // Winner already paid
          l_d_paid_winner == True,
          // Signed by lottery admin
          list.has(extra_signatories, l_d_admin),
        }
      }
    }
  }

  else(_) {
    fail
  }
}
