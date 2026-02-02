#! /bin/bash

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
tx_out_alice=10000000000 # Alice: 10 Ada
tx_out_bob=10000000000 # Bob: 10 Ada
tx_out_ida=10000000000 # Ida: 10 Ada

# Total output without fee
total_output=$((tx_out_alice + tx_out_bob + tx_out_ida))

fee=1000000

# Calculate remaining balance to return to the genesis address
change=$((tx_in_amount - total_output - fee))

# Build the raw transaction
cardano-cli latest transaction build-raw \
  --tx-in $tx_in1 \
  --tx-out "$alice_address+$tx_out_alice" \
  --tx-out "$bob_address+$tx_out_bob" \
  --tx-out "$ida_address+$tx_out_ida" \
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

echo "Querying and saving the first UTXO details for Alice address to /shared/alice.utxo:"
cardano-cli latest query utxo --testnet-magic 42 --address "${alice_address}" | /busybox awk 'NR>2 { print $1 "#" $2; exit }' > /shared/alice.utxo
echo "UTXO details for Alice saved in /shared/alice.utxo."
cat /shared/alice.utxo

echo "Querying and saving the first UTXO details for Bob address to /shared/bob.utxo:"
cardano-cli latest query utxo --testnet-magic 42 --address "${bob_address}" | /busybox awk 'NR>2 { print $1 "#" $2; exit }' > /shared/bob.utxo
echo "UTXO details for Bob saved in /shared/bob.utxo."
cat /shared/bob.utxo

echo "Querying and saving the first UTXO details for Ida address to /shared/ida.utxo:"
cardano-cli latest query utxo --testnet-magic 42 --address "${ida_address}" | /busybox awk 'NR>2 { print $1 "#" $2; exit }' > /shared/ida.utxo
echo "UTXO details for Ida saved in /shared/ida.utxo."
cat /shared/ida.utxo

echo "Querying and saving the first UTXO details for genesis address to /shared/genesis.utxo:"
cardano-cli latest query utxo --testnet-magic 42 --address "${genesis_address}" | /busybox awk 'NR>2 { print $1 "#" $2; exit }' > /shared/genesis.utxo
cat /shared/genesis.utxo

touch /shared/cardano.ready

wait
