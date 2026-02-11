#!/bin/sh
# Lightweight HTTP API for cardano-cli queries using socat.
# Runs inside the cardano-node container on port 1442.
#
# Endpoints:
#   GET /utxo?address=<addr>       → JSON UTXO set at address
#   GET /utxo?txin=<hash>%23<idx>  → JSON single UTXO by tx-in (# url-encoded as %23)
#   GET /protocol-parameters       → JSON protocol parameters
#   GET /tip                       → JSON chain tip
#
# Usage: socat TCP-LISTEN:1442,reuseaddr,fork SYSTEM:"/cardano-query-api.sh"

# Read the HTTP request line
read -r REQUEST_LINE

# Parse method and path (pure shell — no grep/sed/awk needed)
METHOD="${REQUEST_LINE%% *}"
rest="${REQUEST_LINE#* }"
FULL_PATH="${rest%% *}"

case "$FULL_PATH" in
  *\?*) PATH_ONLY="${FULL_PATH%%\?*}"; QUERY_STRING="${FULL_PATH#*\?}" ;;
  *)    PATH_ONLY="$FULL_PATH";        QUERY_STRING="" ;;
esac

# Consume remaining headers (stop at blank line / lone \r)
CR=$(printf '\r')
while IFS= read -r HEADER; do
  case "$HEADER" in
    ""|"$CR") break ;;
  esac
done

# Respond
respond() {
  STATUS="$1"
  BODY="$2"
  CONTENT_TYPE="${3:-application/json}"
  printf "HTTP/1.1 %s\r\nContent-Type: %s\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n%s" \
    "$STATUS" "$CONTENT_TYPE" "$BODY"
}

case "$PATH_ONLY" in
  /utxo)
    # Extract parameters from query string (pure shell)
    ADDR="" TXIN=""
    case "$QUERY_STRING" in
      *address=*) ADDR="${QUERY_STRING#*address=}"; ADDR="${ADDR%%&*}" ;;
    esac
    case "$QUERY_STRING" in
      *txin=*) TXIN="${QUERY_STRING#*txin=}"; TXIN="${TXIN%%&*}" ;;
    esac
    # URL-decode %23 → # (the only encoding we need)
    case "$TXIN" in *%23*) TXIN="${TXIN%%\%23*}#${TXIN#*\%23}" ;; esac

    if [ -n "$TXIN" ]; then
      RESULT=$(cardano-cli latest query utxo --tx-in "$TXIN" --testnet-magic 42 --output-json 2>&1)
      EXIT_CODE=$?
    elif [ -n "$ADDR" ]; then
      RESULT=$(cardano-cli latest query utxo --address "$ADDR" --testnet-magic 42 --output-json 2>&1)
      EXIT_CODE=$?
    else
      respond "400 Bad Request" '{"error":"missing address or txin parameter"}'
      exit 0
    fi

    if [ $EXIT_CODE -eq 0 ]; then
      respond "200 OK" "$RESULT"
    else
      respond "500 Internal Server Error" "{\"error\":\"cardano-cli failed\",\"details\":\"$RESULT\"}"
    fi
    ;;
  /protocol-parameters)
    RESULT=$(cardano-cli latest query protocol-parameters --testnet-magic 42 2>&1)
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
      respond "200 OK" "$RESULT"
    else
      respond "500 Internal Server Error" "{\"error\":\"$RESULT\"}"
    fi
    ;;
  /tip)
    RESULT=$(cardano-cli latest query tip --testnet-magic 42 2>&1)
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
      respond "200 OK" "$RESULT"
    else
      respond "500 Internal Server Error" "{\"error\":\"$RESULT\"}"
    fi
    ;;
  *)
    respond "404 Not Found" '{"error":"unknown endpoint","endpoints":["/utxo?address=...","/protocol-parameters","/tip"]}'
    ;;
esac
