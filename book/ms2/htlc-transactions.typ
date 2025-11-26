#import "../lib/transaction.typ": *

#set page(
  height: auto,
)

#let tx_claim_htlc = vanilla_transaction(
  "Claim HTLC",
  inputs: (
    ( name: "HTLC",
      address: "HTLC Script",
      value: ("": "V'"),
      datum: (HtlcDatum: (hash: "", timeout: "", sender: "", receiver: "", desired_output: (address: [A], value: [V], datum: [D]))),
      redeemer: "Claim(s)"
    ),
  ),
  outputs: (
    ( name: "Desired Output",
      address: "A",
      value: (
        "": "V"
      ),
      datum: ("D":""),
      ),
  ),
  signatures: ("receiver",),
  validRange: (("upper": "timeout")),
  notes: [
    Blake2b_256(s) == hash
  ]
)

#let export = sys.inputs.export

#(
  if export == "claim" {
    tx_claim_htlc
  } else {
    [Unknown export target: #export]
  }
)

