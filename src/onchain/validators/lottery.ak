use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{OutputReference, Transaction}

pub type LotteryRedeemer {
  SelectWinner
  Close
}

pub type LotteryMintRedeemer {
  Mint(OutputReference)
  Burn
}

pub type LotteryDatum {
  prize: Int,
  ticket_cost: Int,
  winner: Option<OutputReference>,
  close_timestamp: Int,
  admin: VerificationKeyHash,
}

pub type DesiredOutput {
  address: Address,
  value: Pairs<PolicyId, Pairs<AssetName, Int>>,
  datum: Option<Data>,
}

validator lottery {
  spend(
    datum: Option<LotteryDatum>,
    redeemer: LotteryRedeemer,
    input: OutputReference,
    tx: Transaction,
  ) {
    when redeemer is {
      // Timestamp has passed
      // Winner == None
      // Signed by Admin
      // Winner is in reference inputs
      // Winner has enough ada
      SelectWinner -> True

      // Signed by Admin
      // Token Burnt
      Close -> True
    }
  }

  mint(redeemer: LotteryMintRedeemer, own_policy: PolicyId, tx: Transaction) {
    when redeemer is {
      // OutputRef from redeemer is being consumed
      // Only one token is minted
      // TN == hash(redeemer)
      // qty == 1
      // Paid to own script
      // Validate datum
      //    - Timetamp in the future
      //    - No winner
      //    - Ticket cost and prize > 0
      //    - admin is signing the tx
      Mint(ref) -> True
      // Only one token is being burned
      Burn -> True
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
  lottery_id: OutputReference,
  desired_output: DesiredOutput,
}

validator ticket {
  spend(
    datum: Option<TicketDatum>,
    redeemer: TicketRedeemer,
    input: OutputReference,
    tx: Transaction,
  ) {
    // Lottery with correct token is in reference inputs

    when redeemer is {
      // Winner matches own ref
      // Desired output is created
      Win -> True
      // Winner doesn't match own ref
      Lose -> True
    }
  }

  else(_) {
    fail
  }
}
