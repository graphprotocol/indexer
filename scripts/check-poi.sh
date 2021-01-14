#!/bin/bash

set -e

QUERY_NODE_STATUS_ENDPOINT=$1
ETHEREUM_NODE=$2
EPOCH=$3
INDEXER=$4

if [[ -z "$QUERY_NODE_STATUS_ENDPOINT" ]] || [[ -z "$EPOCH" ]] || [[ -z "$INDEXER" ]] || [[ -z "$ETHEREUM_NODE" ]]; then
  echo "Usage: $0 <query-node-status-endpoint> <ethereum-node> <epoch-number> <indexer-address>"
  echo
  echo "Example: $0 http://localhost:8030/graphql http://localhost:8545/ 29 0x0000000000000000000000000000000000000000"
  exit 1
fi

if ! (which http &>/dev/null); then
  echo "The 'http' command (https://httpie.io/) must be installed for this script to work."
  exit 1
fi

CURRENT_EPOCH=$(http -b post https://gateway.network.thegraph.com/network query='{ graphNetworks { currentEpoch } }' | jq '.data.graphNetworks[0].currentEpoch')
echo "Current epoch:" $CURRENT_EPOCH

START_BLOCK=$(http -b post https://gateway.network.thegraph.com/network query='query epoch($epoch: ID!) { epoch(id: $epoch) { startBlock } }' variables:="{ \"epoch\": \"$EPOCH\" }" | jq .data.epoch.startBlock)
START_BLOCK_HEX=$(printf '%x' $START_BLOCK)
echo "Epoch start block:" $START_BLOCK "(0x$START_BLOCK_HEX)"

BLOCK_DATA=$(http -b post "$ETHEREUM_NODE" jsonrpc="2.0" id="1" method="eth_getBlockByNumber" params:="[\"0x$START_BLOCK_HEX\", false]" | jq -c '.result | { number, hash }')
echo "Block number and hash:" $BLOCK_DATA

HASH=$(echo $BLOCK_DATA | jq '.hash')
NON_HEX_NUMBER=$(echo "$BLOCK_DATA" | jq '.number' | xargs printf '%d')
VARIABLES="{\"number\": $NON_HEX_NUMBER, \"hash\": $HASH, \"indexer\": \"$INDEXER\"}"
echo "Proof of Indexing parameters:" $VARIABLES

echo "---"

http -b post $QUERY_NODE_STATUS_ENDPOINT \
  query='query poi($number: Int!, $hash: String!, $indexer: String!) { proofOfIndexing(subgraph: "QmRhYzT8HEZ9LziQhP6JfNfd4co9A7muUYQhPMJsMUojSF", blockNumber: $number, blockHash: $hash, indexer: $indexer) }' \
  variables:="$(echo $VARIABLES)"