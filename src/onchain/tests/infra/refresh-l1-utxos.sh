#!/bin/sh
# Refresh initial-l1-utxos.json with the current L1 UTXO state.
#
# Run this after a commit+merge cycle (or any L1-mutating operation) to
# update the cached UTXOs so the next run of commit.ts picks up the
# correct inputs — without having to restart the entire infrastructure.
#
# Usage: ./refresh-l1-utxos.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API="http://127.0.0.1:1442"

ALICE_ADDR=$(cat "$SCRIPT_DIR/credentials/alice/alice-funds.addr" | tr -d '\n\r')
BOB_ADDR=$(cat "$SCRIPT_DIR/credentials/bob/bob-funds.addr" | tr -d '\n\r')
IDA_ADDR=$(cat "$SCRIPT_DIR/credentials/ida/ida-funds.addr" | tr -d '\n\r')

echo "Querying L1 UTXOs..."

ALICE_UTXOS=$(curl -sf "$API/utxo?address=$ALICE_ADDR")
BOB_UTXOS=$(curl -sf "$API/utxo?address=$BOB_ADDR")
IDA_UTXOS=$(curl -sf "$API/utxo?address=$IDA_ADDR")

cat > "$SCRIPT_DIR/initial-l1-utxos.json" <<EOF
{
  "alice": $ALICE_UTXOS,
  "bob": $BOB_UTXOS,
  "ida": $IDA_UTXOS
}
EOF

echo "Updated $SCRIPT_DIR/initial-l1-utxos.json"
echo "  alice: $(echo "$ALICE_UTXOS" | grep -c '"lovelace"') UTXOs"
echo "  bob:   $(echo "$BOB_UTXOS" | grep -c '"lovelace"') UTXOs"
echo "  ida:   $(echo "$IDA_UTXOS" | grep -c '"lovelace"') UTXOs"
