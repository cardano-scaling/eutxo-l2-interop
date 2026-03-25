// lottery contract transactions

#import "../lib/transaction.typ": *

#set page(
  height: auto,
)

#let tx_mint_lottery = transaction(
  "Mint Lottery",
  inputs: (
    (
      name: "Admin UTxO",
      address: "Admin addr",
      value: (
        ADA: "P",
      ),
    ),
  ),
  outputs: (
    (
      name: "Lottery UTxO",
      address: "Lottery script",
      value: (
        ADA: "P",
        LotteryToken: "1",
      ),
      datum: (
        admin: [VKH],
        prize: [P],
        ticket_cost: [C],
        close_timestamp: [T],
        paid_winner: [*False*]
      ),
    ),
  ),
  signatures: (
    "admin",
  ),
  validRange: (
    upper: "T - 1",
  ),
)

#let tx_buy_ticket = transaction(
  "Buy Ticket",
  inputs: (
    (
      name: "User UTxO",
      address: "User addr",
      value: (
        ADA: "C",
      ),
    ),
  ),
  outputs: (
    (
      name: "Ticket UTxO",
      address: "Ticket script",
      value: (
        ADA: "C",
      ),
      datum: (
        lottery_id: [TokenName],
        desired_output: [DesiredOutput],
      ),
    ),
  ),
)

#let tx_pay_winner = transaction(
  "Pay Winner",
  inputs: (
    (
      name: "Lottery UTxO",
      address: "Lottery script",
      value: (
        ADA: "L",
        LotteryToken: "1",
      ),
      datum: (
        admin: [VKH],
        prize: [P],
        ticket_cost: [C],
        close_timestamp: [T],
        paid_winner: [False]
      ),
      redeemer: "PayWinner(TicketRef)",
    ),
    (
      name: "Ticket UTxO",
      address: "Ticket script",
      value: (
        ADA: "C",
      ),
      datum: (
        lottery_id: [TokenName],
        desired_output: [DesiredOutput],
      ),
      redeemer: "Win",
    ),
  ),
  outputs: (
    (
      name: "Lottery UTxO",
      address: "Lottery script",
      value: (
        ADA: "L + C - P",
        LotteryToken: "1",
      ),
      datum: (
        admin: [VKH],
        prize: [P],
        ticket_cost: [C],
        close_timestamp: [T],
        paid_winner: [*True*]
      ),
    ),
    (
      name: "Desired Output",
      address: "User addr",
      value: (
        ADA: "P",
      ),
      datum: (
        "DesiredDatum": "",
      ),
    ),
  ),
  signatures: (
    "admin",
  ),
  validRange: (
    lower: "T + 1",
  ),
)

#let tx_collect_losing = vanilla_transaction(
  "Collect Losing Tickets",
  inputs: (
    (
      name: "Lottery UTxO",
      address: "Lottery script",
      value: (
        LotteryToken: "1",
      ),
      datum: (
        admin: [VKH],
        paid_winner: [True],
        "...":""
      ),
      reference: true,
    ),
    (
      name: "Ticket UTxO₁",
      address: "Ticket script",
      value: (
        ADA: "C",
      ),
      datum: (
        lottery_id: [TokenName],
        desired_output: [DesiredOutput],
      ),
      redeemer: "Lose",
    ),
    (dots: ""),
    (
      name: "Ticket UTxOₙ",
      address: "Ticket script",
      value: (
        ADA: "C",
      ),
      datum: (
        lottery_id: [TokenName],
        desired_output: [DesiredOutput],
      ),
      redeemer: "Lose",
    ),
  ),
  outputs: (
    (
      name: "Admin Output",
      address: "Admin addr",
      value: (
        ADA: "n * C",
      ),
    ),
  ),
  signatures: (
    "admin",
  ),
)

#let tx_close_lottery = transaction(
  "Close Lottery",
  inputs: (
    (
      name: "Lottery UTxO",
      address: "Lottery script",
      value: (
        ADA: "N",
        LotteryToken: "1",
      ),
      datum: (
        paid_winner: [True]
      ),
      redeemer: "Close",
    ),
  ),
  outputs: (
    (
      name: "Admin Output",
      address: "Admin addr",
      value: (
        ADA: "N",
      ),
    ),
  ),
  signatures: (
    "admin",
  ),
)

#let export = sys.inputs.export

#(
  if export == "mint_lottery" {
    tx_mint_lottery
  } else if export == "buy_ticket" {
    tx_buy_ticket
  } else if export == "pay_winner" {
    tx_pay_winner
  } else if export == "collect_losing" {
    tx_collect_losing
  } else if export == "close_lottery" {
    tx_close_lottery
  } else {
    [Unknown export target: #export]
  }
)
