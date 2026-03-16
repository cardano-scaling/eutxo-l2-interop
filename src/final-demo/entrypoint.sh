#!/bin/bash
set -euo pipefail

exec /bin/bash /testnet/cardano-private-testnet-config/cardano/entrypoint.sh "$@"
