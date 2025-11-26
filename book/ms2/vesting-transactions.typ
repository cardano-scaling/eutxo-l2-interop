#import "../lib/transaction.typ": *

#set page(
  height: auto,
)

#let tx_claim_vesting = vanilla_transaction(
  "Claim Vesting",
  inputs: (
    ( name: "Vesting",
      address: "Vesting Script",
      value: ("": "V"),
      datum: (VestingDatum: (timeout: "", receiver: "")),
      redeemer: ""
    ),
  ),
  outputs: (
    ( name: "Payout Output",
      value: (
        "": "V"
      ),
    ),
  ),
  signatures: ("receiver",),
  validRange: (("upper": "timeout")),
)

#let tx_lock_vesting = transaction(
  "Lock Vesting",
  inputs: ((
      name: "User Input",
      value:("":"I"),
    ),
  ),
  outputs: (
    ( name: "Vesting",
      address: "Vesting Script",
      value: ("":"V"),
      datum: (VestingDatum: (timeout: "", receiver: ""))
    ),
    ( name: "Change Output",
      value: ("":"I - V"
     ),
    )
  )
)

#let export = sys.inputs.export

#(
  if export == "claim" {
    tx_claim_vesting
  } else if export == "lock" {
    tx_lock_vesting
  } else {
    [Unknown export target: #export]
  }
)

