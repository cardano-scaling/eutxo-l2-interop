typst compile ms1/htlc-transactions.typ ms1/tx_lock_htlc.svg --input export="lock" --root .
typst compile ms1/htlc-transactions.typ ms1/tx_claim_htlc.svg --input export="claim" --root .
typst compile ms1/htlc-transactions.typ ms1/tx_refund_htlc.svg --input export="refund" --root .
typst compile ms1/adhoc-ledger-transactions.typ ms1/tx_wrap_utxo.svg --input export="wrap" --root .
typst compile ms1/adhoc-ledger-transactions.typ ms1/tx_htlc_verify_lock.svg --input export="verify_lock" --root .
typst compile ms1/adhoc-ledger-transactions.typ ms1/tx_htlc_perform_lock.svg --input export="perform_lock" --root .