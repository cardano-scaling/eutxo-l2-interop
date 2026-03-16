#!/bin/sh

echo "Waiting for Cardano node to be ready..."
while [ ! -f /shared/cardano.ready ]; do
  sleep 2
done
echo "Cardano node is ready. Waiting additional time for node to be ready for transactions..."
sleep 5
echo "Checking if node socket is accessible..."
if [ ! -S /data/node.socket ]; then
  echo "ERROR: Node socket not found at /data/node.socket"
  exit 1
fi
echo "Node socket verified, proceeding with script publication..."
echo ""
echo "=========================================="
echo "Publishing Hydra reference scripts to L1"
echo "=========================================="
echo "Checking socket access..."
if [ ! -S /data/node.socket ]; then
  echo "ERROR: Socket /data/node.socket not found or not accessible"
  exit 1
fi
echo "Socket found, publishing scripts..."
set +e
HYDRA_NODE_PATH=$(find /nix/store -name "hydra-node" -type f 2>/dev/null | head -1)
if [ -z "$HYDRA_NODE_PATH" ]; then
  echo "ERROR: hydra-node binary not found"
  exit 1
fi
echo "Using hydra-node at: $HYDRA_NODE_PATH"
if [ -f /shared/hydra-scripts-tx-id.txt ] && [ -s /shared/hydra-scripts-tx-id.txt ]; then
  EXISTING_TX_ID=$(cat /shared/hydra-scripts-tx-id.txt | tr -d '\n\r')
  echo "Hydra scripts already published with transaction ID: $EXISTING_TX_ID"
  echo "Skipping publish-scripts (scripts already on-chain)"
  HYDRA_SCRIPTS_TX_ID=$EXISTING_TX_ID
  EXIT_CODE=0
  mkdir -p /devnet/persistence
  echo "$HYDRA_SCRIPTS_TX_ID" > /devnet/persistence/hydra-scripts-tx-id.txt
  echo "Using existing transaction ID for Hydra nodes"
else
  echo "Running publish-scripts command..."
  set +e
  HYDRA_SCRIPTS_TX_ID=$($HYDRA_NODE_PATH publish-scripts \
    --testnet-magic 42 \
    --node-socket /data/node.socket \
    --cardano-signing-key /devnet/credentials/alice/alice-funds.sk 2>&1)
  EXIT_CODE=$?
  set -e
  echo "Command completed with exit code: $EXIT_CODE"
  echo "Output: $HYDRA_SCRIPTS_TX_ID"
fi
if [ $EXIT_CODE -eq 0 ] && [ -n "$HYDRA_SCRIPTS_TX_ID" ] && [ "$HYDRA_SCRIPTS_TX_ID" != "Usage:" ]; then
  echo "Hydra scripts published successfully!"
  echo "Transaction ID: $HYDRA_SCRIPTS_TX_ID"
  echo "$HYDRA_SCRIPTS_TX_ID" > /shared/hydra-scripts-tx-id.txt
  mkdir -p /devnet/persistence
  echo "$HYDRA_SCRIPTS_TX_ID" > /devnet/persistence/hydra-scripts-tx-id.txt
  echo "Saved transaction ID to /shared/hydra-scripts-tx-id.txt (for containers)"
  echo "Saved transaction ID to /devnet/persistence/hydra-scripts-tx-id.txt (for host access)"
  echo "You can now use --hydra-scripts-tx-id $(cat /shared/hydra-scripts-tx-id.txt) with your Hydra nodes"
else
  echo "ERROR: Failed to publish Hydra scripts (exit code: $EXIT_CODE)"
  echo "Output: $HYDRA_SCRIPTS_TX_ID"
  echo "You may need to publish them manually later."
  exit 1
fi
