#! /bin/bash

# Remove sentinel so the app and scripts know infra is not ready yet
rm -f /devnet/l1-utxos.ready

chmod 600 /keys/*
chmod +x /busybox
chmod 777 /shared

echo "Calculating target time for synchronised chain start..."

target_time=$(( ($(date +%s) / 10 + 1) * 10 ))
echo "$target_time" > /shared/cardano.start
byron_startTime=$target_time
shelley_systemStart=$(date --utc +"%Y-%m-%dT%H:%M:%SZ" --date="@$target_time")

/busybox sed "s/\"startTime\": [0-9]*/\"startTime\": $byron_startTime/" /shared/byron/genesis.json.base > /shared/byron/genesis.json
echo "Updated startTime value in Byron genesis.json to: $byron_startTime"

/busybox sed "s/\"systemStart\": \"[^\"]*\"/\"systemStart\": \"$shelley_systemStart\"/" /shared/shelley/genesis.json.base > /shared/shelley/genesis.json
echo "Updated systemStart value in Shelley genesis.json to: $shelley_systemStart"

echo "Parsing epochLength and slotLength from Shelley genesis.json..."
/busybox awk -F':|,' '/"epochLength"/ {print $2}' /shared/shelley/genesis.json.base > /shared/mc-epoch-length
echo "Created /shared/mc-epoch-length with value: $(cat /shared/mc-epoch-length)"

/busybox awk -F':|,' '/"slotLength"/ {print $2}' /shared/shelley/genesis.json.base > /shared/mc-slot-length
echo "Created /shared/mc-slot-length with value: $(cat /shared/mc-slot-length)"

cp /shared/conway/genesis.conway.json.base /shared/conway/genesis.conway.json
cp /shared/shelley/genesis.alonzo.json.base /shared/shelley/genesis.alonzo.json
echo "Created /shared/conway/genesis.conway.json and /shared/shelley/genesis.alonzo.json"

byron_hash=$(/bin/cardano-cli byron genesis print-genesis-hash --genesis-json /shared/byron/genesis.json)
shelley_hash=$(/bin/cardano-cli latest genesis hash --genesis /shared/shelley/genesis.json)
alonzo_hash=$(/bin/cardano-cli latest genesis hash --genesis /shared/shelley/genesis.alonzo.json)
conway_hash=$(/bin/cardano-cli latest genesis hash --genesis /shared/conway/genesis.conway.json)

/busybox sed "s/\"ByronGenesisHash\": \"[^\"]*\"/\"ByronGenesisHash\": \"$byron_hash\"/" /shared/node-1-config.json.base > /shared/node-1-config.json.base.byron
/busybox sed "s/\"ByronGenesisHash\": \"[^\"]*\"/\"ByronGenesisHash\": \"$byron_hash\"/" /shared/db-sync-config.json.base > /shared/db-sync-config.json.base.byron
/busybox sed "s/\"ShelleyGenesisHash\": \"[^\"]*\"/\"ShelleyGenesisHash\": \"$shelley_hash\"/" /shared/node-1-config.json.base.byron > /shared/node-1-config.base.shelley
/busybox sed "s/\"ShelleyGenesisHash\": \"[^\"]*\"/\"ShelleyGenesisHash\": \"$shelley_hash\"/" /shared/db-sync-config.json.base.byron > /shared/db-sync-config.base.shelley
/busybox sed "s/\"AlonzoGenesisHash\": \"[^\"]*\"/\"AlonzoGenesisHash\": \"$alonzo_hash\"/" /shared/node-1-config.base.shelley > /shared/node-1-config.json.base.conway
/busybox sed "s/\"AlonzoGenesisHash\": \"[^\"]*\"/\"AlonzoGenesisHash\": \"$alonzo_hash\"/" /shared/db-sync-config.base.shelley > /shared/db-sync-config.json.base.conway
/busybox sed "s/\"ConwayGenesisHash\": \"[^\"]*\"/\"ConwayGenesisHash\": \"$conway_hash\"/" /shared/node-1-config.json.base.conway > /shared/node-1-config.json
/busybox sed "s/\"ConwayGenesisHash\": \"[^\"]*\"/\"ConwayGenesisHash\": \"$conway_hash\"/" /shared/db-sync-config.json.base.conway > /shared/db-sync-config.json

echo "Updated ByronGenesisHash value in config files to: $byron_hash"
echo "Updated ShelleyGenesisHash value in config files to: $shelley_hash"
echo "Updated ConwayGenesisHash value in config files to: $conway_hash"

byron_startTimeMillis=$(($byron_startTime * 1000))
echo $byron_startTimeMillis > /shared/MC__FIRST_EPOCH_TIMESTAMP_MILLIS
echo "Created /shared/MC__FIRST_EPOCH_TIMESTAMP_MILLIS with value: $byron_startTimeMillis"

echo "Current time is now: $(date +"%H:%M:%S.%3N"). Starting node..."

cardano-node run \
  --topology /shared/node-1-topology.json \
  --database-path /data/db \
  --socket-path /data/node.socket \
  --host-addr 0.0.0.0 \
  --port 32000 \
  --config /shared/node-1-config.json \
  --shelley-kes-key /keys/kes.skey \
  --shelley-vrf-key /keys/vrf.skey \
  --shelley-operational-certificate /keys/node.cert &

echo "Waiting for node.socket..."

while true; do
    if [ -e "/data/node.socket" ]; then
        break
    else
        sleep 1
    fi
done

# Create symlink to shared volume so Hydra nodes can access the socket
echo "Creating symlink to shared volume for socket access..."
ln -sf /data/node.socket /shared/node.socket
echo "Socket symlink created at /shared/node.socket"

# Start lightweight HTTP query API (socat-based, port 1442)
chmod +x /cardano-query-api.sh
socat TCP-LISTEN:1442,reuseaddr,fork SYSTEM:"/cardano-query-api.sh" &
echo "Cardano query API started on port 1442"

# Read addresses from mounted credentials
alice_address=$(cat /devnet/credentials/alice/alice-funds.addr | tr -d '\n\r')
bob_address=$(cat /devnet/credentials/bob/bob-funds.addr | tr -d '\n\r')
ida_address=$(cat /devnet/credentials/ida/ida-funds.addr | tr -d '\n\r')
genesis_address=$(cat /shared/shelley/genesis-utxo.addr | tr -d '\n\r')

echo "Alice address: $alice_address"
echo "Bob address: $bob_address"
echo "Ida address: $ida_address"
echo "Genesis address: $genesis_address"

# Define the UTXO details and amounts
tx_in1="781cb948a37c7c38b43872af9b1e22135a94826eafd3740260a6db0a303885d8#0"
tx_in_amount=29993040000000000

# Define output amounts (in lovelace)
# Each participant gets 2 UTXOs per head: one for Hydra fuel, one for committing.
# Fuel must be LARGER than commit — the Hydra node picks fuel and the commit
# endpoint builds a tx that also requires fuel for on-chain fees.
# Ida participates in BOTH heads, so she gets 4 UTXOs (2 per head).
tx_fuel=9000000000     # 9.000 Ada fuel (for on-chain Hydra tx fees)
tx_commit=1000000000   # 1.000 Ada to commit into the head

# Alice: 2, Bob: 2, Ida: 4 = 10 UTXOs total (but 4 unique pairs)
total_output=$(( (tx_fuel + tx_commit) * 4 ))

fee=1000000

# Calculate remaining balance to return to the genesis address
change=$((tx_in_amount - total_output - fee))

# Build the raw transaction
# Alice: 2 UTXOs (fuel + commit) — for Head A
# Bob:   2 UTXOs (fuel + commit) — for Head B
# Ida:   4 UTXOs (fuel + commit for Head A, fuel + commit for Head B)
cardano-cli latest transaction build-raw \
  --tx-in $tx_in1 \
  --tx-out "$alice_address+$tx_fuel" \
  --tx-out "$alice_address+$tx_commit" \
  --tx-out "$bob_address+$tx_fuel" \
  --tx-out "$bob_address+$tx_commit" \
  --tx-out "$ida_address+$tx_fuel" \
  --tx-out "$ida_address+$tx_commit" \
  --tx-out "$ida_address+$tx_fuel" \
  --tx-out "$ida_address+$tx_commit" \
  --tx-out "$genesis_address+$change" \
  --fee $fee \
  --out-file /data/tx.raw

# Sign the transaction
cardano-cli latest transaction sign \
  --tx-body-file /data/tx.raw \
  --signing-key-file /shared/shelley/genesis-utxo.skey \
  --testnet-magic 42 \
  --out-file /data/tx.signed

cat /data/tx.signed

echo "Submitting transaction..."
cardano-cli latest transaction submit \
  --tx-file /data/tx.signed \
  --testnet-magic 42

echo "Transaction submitted to fund Alice, Bob, and Ida addresses. Waiting 20 seconds for transaction to process..."
sleep 20
echo "Balance:"

echo "Querying UTXO for Alice address:"
cardano-cli latest query utxo \
  --testnet-magic 42 \
  --address $alice_address

echo "Querying UTXO for Bob address:"
cardano-cli latest query utxo \
  --testnet-magic 42 \
  --address $bob_address

echo "Querying UTXO for Ida address:"
cardano-cli latest query utxo \
  --testnet-magic 42 \
  --address $ida_address

# Save individual first-UTXO refs (legacy, used by Hydra nodes)
cardano-cli latest query utxo --testnet-magic 42 --address "${alice_address}" | /busybox awk 'NR>2 { print $1 "#" $2; exit }' > /shared/alice.utxo
cardano-cli latest query utxo --testnet-magic 42 --address "${bob_address}" | /busybox awk 'NR>2 { print $1 "#" $2; exit }' > /shared/bob.utxo
cardano-cli latest query utxo --testnet-magic 42 --address "${ida_address}" | /busybox awk 'NR>2 { print $1 "#" $2; exit }' > /shared/ida.utxo
cardano-cli latest query utxo --testnet-magic 42 --address "${genesis_address}" | /busybox awk 'NR>2 { print $1 "#" $2; exit }' > /shared/genesis.utxo

# Write full UTXO JSON for each participant (consumed by commit script on host)
echo "Writing initial L1 UTXOs JSON to /devnet/l1-utxos.json..."
{
  echo '{'
  echo '  "alice":'
  cardano-cli latest query utxo --testnet-magic 42 --address "${alice_address}" --output-json
  echo '  ,'
  echo '  "bob":'
  cardano-cli latest query utxo --testnet-magic 42 --address "${bob_address}" --output-json
  echo '  ,'
  echo '  "ida":'
  cardano-cli latest query utxo --testnet-magic 42 --address "${ida_address}" --output-json
  echo '}'
} > /devnet/l1-utxos.json
chmod 666 /devnet/l1-utxos.json
chown 1000:1000 /devnet/l1-utxos.json 2>/dev/null || true
echo "Saved l1-utxos.json"
cat /devnet/l1-utxos.json

touch /shared/cardano.ready

# Background watcher: after hydra-scripts-publisher finishes (using Alice's key),
# Alice has a single change UTXO. Split it into fuel + commit so the commit
# script sees 2 UTXOs, then refresh the JSON file.
(
  echo "[utxo-refresh] Waiting for hydra-scripts-publisher to finish..."
  while [ ! -f /shared/hydra-scripts-tx-id.txt ]; do sleep 2; done
  echo "[utxo-refresh] Publisher done. Waiting 10s for chain to settle..."
  sleep 10

  alice_addr=$(cat /devnet/credentials/alice/alice-funds.addr | tr -d '\n\r')
  bob_addr=$(cat /devnet/credentials/bob/bob-funds.addr | tr -d '\n\r')
  ida_addr=$(cat /devnet/credentials/ida/ida-funds.addr | tr -d '\n\r')

  # --- Split Alice's single UTXO into fuel + commit ---
  echo "[utxo-refresh] Querying Alice's current UTXOs..."
  alice_utxo_line=$(cardano-cli latest query utxo --testnet-magic 42 --address "${alice_addr}" | /busybox awk 'NR>2 { print $1, $2, $3; exit }')
  alice_txhash=$(echo "$alice_utxo_line" | /busybox awk '{print $1}')
  alice_txix=$(echo "$alice_utxo_line" | /busybox awk '{print $2}')
  alice_balance=$(echo "$alice_utxo_line" | /busybox awk '{print $3}')
  echo "[utxo-refresh] Alice UTXO: ${alice_txhash}#${alice_txix} = ${alice_balance} lovelace"

  split_fee=200000
  split_commit=1000000000   # 1000 ADA to commit into the head
  split_fuel=$((alice_balance - split_commit - split_fee))  # rest goes to fuel
  echo "[utxo-refresh] Splitting → fuel: ${split_fuel}, commit: ${split_commit}, fee: ${split_fee}"

  cardano-cli latest transaction build-raw \
    --tx-in "${alice_txhash}#${alice_txix}" \
    --tx-out "${alice_addr}+${split_fuel}" \
    --tx-out "${alice_addr}+${split_commit}" \
    --fee ${split_fee} \
    --out-file /data/alice-split.raw

  cardano-cli latest transaction sign \
    --tx-body-file /data/alice-split.raw \
    --signing-key-file /devnet/credentials/alice/alice-funds.sk \
    --testnet-magic 42 \
    --out-file /data/alice-split.signed

  cardano-cli latest transaction submit \
    --tx-file /data/alice-split.signed \
    --testnet-magic 42
  echo "[utxo-refresh] Alice split tx submitted. Waiting 6s for confirmation..."
  sleep 6

  # --- Refresh the UTXO JSON file ---
  echo "[utxo-refresh] Re-querying UTXOs for all participants..."
  {
    echo '{'
    echo '  "alice":'
    cardano-cli latest query utxo --testnet-magic 42 --address "${alice_addr}" --output-json
    echo '  ,'
    echo '  "bob":'
    cardano-cli latest query utxo --testnet-magic 42 --address "${bob_addr}" --output-json
    echo '  ,'
    echo '  "ida":'
    cardano-cli latest query utxo --testnet-magic 42 --address "${ida_addr}" --output-json
    echo '}'
  } > /devnet/l1-utxos.json.tmp
  mv /devnet/l1-utxos.json.tmp /devnet/l1-utxos.json
  chmod 666 /devnet/l1-utxos.json
  chown 1000:1000 /devnet/l1-utxos.json 2>/dev/null || true

  echo "[utxo-refresh] Updated l1-utxos.json:"
  cat /devnet/l1-utxos.json

  # Signal that infra is fully ready (L1 UTXOs available)
  touch /devnet/l1-utxos.ready
  echo "[utxo-refresh] Done. Sentinel written: /devnet/l1-utxos.ready"
) &

wait
