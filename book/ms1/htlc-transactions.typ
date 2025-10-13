#import "../lib/transaction.typ": *

#let tx_create_htlc = transaction(
  "Create HTLC",
  inputs: ((
      name: "User Input",
      value: (
        ADA: "I",
      ),
    ),
  ),
  outputs: (
    ( name: "HTLC",
      address: "HTLC Script",
      value: (
        ADA: "P"
      ),
      datum: (HtlcDatum: (hash: "", timeout: "", sender: "", receiver: ""))),
    ( name: "Change Output",
      value: (
        ADA: "I - P"
      ),)
  )
)

#let tx_claim_htlc = transaction(
  "Claim HTLC",
  inputs: (
    ( name: "HTLC",
      address: "HTLC Script",
      value: (
        ADA: "P"
      ),
      datum: (HtlcDatum: (hash: "", timeout: "", sender: "", receiver: "")),
      redeemer: "Claim(s)"
    ),
  ),
  outputs: (
    ( name: "User Output",
      value: (
        ADA: "P"
      ),),
  ),
  signatures: ("receiver",),
  validRange: (("upper": "timeout")),
  notes: [
    Blake2b_256(s) == hash
  ]
)

#let tx_refund_htlc = transaction(
  "Refund HTLC",
  inputs: (
    ( name: "HTLC",
      address: "HTLC Script",
      value: (
        ADA: "P"
      ),
      datum: (HtlcDatum: (hash: "", timeout: "", sender: "", receiver: "")),
      redeemer: "Refund"
    ),
  ),
  outputs: (
    ( name: "User Output",
      value: (
        ADA: "P"
      ),),
  ),
  signatures: ("sender",),
  validRange: (("lower": "timeout")),
)

#let export = sys.inputs.export

#(
  if export == "create" {
    tx_create_htlc
  } else if export == "claim" {
    tx_claim_htlc
  } else if export == "refund" {
    tx_refund_htlc
  } else {
    [Unknown export target: #export]
  }
)
