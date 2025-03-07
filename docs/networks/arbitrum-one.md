# Arbitrum One Configuration

Network information can be found at https://thegraph.com/explorer?chain=arbitrum-one. The Graph Network mainnet is open for everyone to participate in as an indexer. The only requirement is a minimum stake of 100k GRT.

## Latest Releases

| Component          | Release                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| contracts          | [![GitHub Release](https://img.shields.io/github/v/release/graphprotocol/contracts)](https://github.com/graphprotocol/contracts/releases)          |
| indexer-agent      | [![GitHub Release](https://img.shields.io/github/v/release/graphprotocol/indexer)](https://github.com/graphprotocol/indexer/releases)           |
| indexer-cli        | [![GitHub Release](https://img.shields.io/github/v/release/graphprotocol/indexer)](https://github.com/graphprotocol/indexer/releases)            |
| indexer-service-rs | [![GitHub Release](https://img.shields.io/github/v/release/graphprotocol/indexer-rs?filter=indexer-service-rs-v1.4.0)](https://github.com/graphprotocol/indexer-rs/releases?q=indexer-service-rs) |
| indexer-tap-agent  | [![GitHub Release](https://img.shields.io/github/v/release/graphprotocol/indexer-rs?filter=indexer-tap-agent-v1.8.0)](https://github.com/graphprotocol/indexer-rs/releases?q=indexer-tap-agent) |
| graph-node         | [![GitHub Release](https://img.shields.io/github/v/release/graphprotocol/graph-node)](https://github.com/graphprotocol/graph-node/releases)         |

## Network Parameters

| Parameter                   | Value                 |
| --------------------------- | --------------------  |
| Epoch length                | ~ 24h (6646 blocks)   |
| Maximum allocation lifetime | ~28 days (28 epochs)  |

## Contracts & accounts

| Name               | Address                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Graph Token (GRT)  | [`0x9623063377AD1B27544C965cCd7342f7EA7e88C7`](https://arbiscan.io/address/0x9623063377AD1B27544C965cCd7342f7EA7e88C7) |
| Staking            | [`0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03`](https://arbiscan.io/address/0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03) |
| Data Edge          | [`0x633bb9790d7c4c59991cebd377c0ed6501a35ebe`](https://arbiscan.io/address/0x633bb9790d7c4c59991cebd377c0ed6501a35ebe) |
| Block Oracle Owner | [`0x5f49491e965895ded343af13389ee45ef60ed793`](https://arbiscan.io/address/0x5f49491e965895ded343af13389ee45ef60ed793) |
| TAP Escrow         | [`0x8f477709eF277d4A880801D01A140a9CF88bA0d3`](https://arbiscan.io/address/0x8f477709eF277d4A880801D01A140a9CF88bA0d3) |

Other network contracts can be found in [graphprotocol/contracts](https://github.com/graphprotocol/contracts/blob/dev/addresses.json#L752) and 
[semiotic-ai/timeline-aggregation-protocol-contracts](https://github.com/semiotic-ai/timeline-aggregation-protocol-contracts/blob/main/addresses.json).

## Configuration

### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                                                                                     |
|---------------------------------------------|---------------------------------| ------------------------------------------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Arbitrum mainnet node/provider                                                                                         |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of mainnet indexer                                                                                       |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of mainnet indexer infrastructure                                                                         |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for mainnet operator                                                                                    |
| `INDEXER_AGENT_GATEWAY_ENDPOINT`            | `--gateway-endpoint`            | `https://gateway-arbitrum.network.thegraph.com/`                                                                          |
| `INDEXER_AGENT_GAS_PRICE_MAX`               | `--gas-price-max`               | `50`                                                                                                                      |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmdKXcBUHR3UyURqVRQHu1oV6VUkBrhi2vNvMx3bNDnUCc`  |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp`   |
| `INDEXER_AGENT_EPOCH_SUBGRAPH_DEPLOYMENT`   | `--epoch-subgraph-deployment`   | `QmW26TG5s9myd1gzio9fkgVHEEjZ7u5ktWDpkNePzbusNo`  |
| `INDEXER_AGENT_EPOCH_SUBGRAPH_ENDPOINT`     | `--epoch-subgraph-endpoint`     | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/4KFYqUWRTZQ9gn7GPHC6YQ2q15chJfVrX43ezYcwkgxB`   |
| `INDEXER_AGENT_TAP_SUBGRAPH_DEPLOYMENT`     | `--tap-subgraph-deployment`     | `QmUhiH6Z5xo6o3GNzsSvqpGKLmCt6w5WzKQ1yHk6C8AA8S`   |
| `INDEXER_AGENT_TAP_SUBGRAPH_ENDPOINT`       | `--tap-subgraph-endpoint`       | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/4sukbNVTzGELnhdnpyPqsf1QqtzNHEYKKmJkgaT8z6M1` |


In order to avoid collecting or claiming query fees below a certain threshold
(e.g. below the cost of the two transactions), the following configuration
option can be used.

| Environment Variable                         | CLI Argument                      | Value                                                                                     |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_REBATE_CLAIM_THRESHOLD`       | `--rebate-claim-threshold`        | Minimum rebate (in GRT) received for an allocation to claim (Default: 1)                |
| `INDEXER_AGENT_REBATE_CLAIM_BATCH_THRESHOLD` | `--rebate-claim-batch-threshold`  | Minimum total rebates (in GRT) before a batched claim is processed (Default: 5)        |
| `INDEXER_AGENT_VOUCHER_EXPIRATION`           | `--voucher-expiration`            | Time (in seconds) to permanently delete vouchers with too few query fees  (Default: 2160) |

### Indexer Service rs *and* TAP Agent

They are configured using a TOML file provided with `--config`. You should start with [the minimal config example](https://github.com/graphprotocol/indexer-rs/blob/main/config/minimal-config-example.toml). You can find the full config [here](https://github.com/graphprotocol/indexer-rs/blob/main/config/maximal-config-example.toml) and the default values 
[here](https://github.com/graphprotocol/indexer-rs/blob/main/config/default_values.toml).

| Variable                               | Value                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `indexer.indexer_address`              | Ethereum address of testnet indexer                                                                                     |
| `indexer.operator_mnemonic`            | Ethereum mnemonic for testnet operator                                                                                  |
| `subgraphs.network.deployment_id`      | `QmUzRg2HHMpbgf6Q4VHKNDbtBEJnyp5JWCh2gUX9AV6jXv`                                                                        |
| `subgraphs.network.query_url`          | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp` |
| `subgraphs.escrow.deployment_id`       | `QmUhiH6Z5xo6o3GNzsSvqpGKLmCt6w5WzKQ1yHk6C8AA8S`                                                                        |
| `subgraphs.escrow.query_url`           | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/4sukbNVTzGELnhdnpyPqsf1QqtzNHEYKKmJkgaT8z6M1` |
| `blockchain.receipts_verifier_address` | `0x33f9E93266ce0E108fc85DdE2f71dab555A0F05a`                                                                            |
| `tap.sender_aggregator_endpoints`      | `0xDDE4cfFd3D9052A9cb618fC05a1Cd02be1f2F467 = https://tap-aggregator.network.thegraph.com`                              |

Notes:
- You can supply those nested values using environment variables as such: `indexer.indexer_address` -> `INDEXER_SERVICE_INDEXER__INDEXER_ADDRESS` (mind the double `_`)
- `tap.sender_aggregator_endpoints` takes a key-value list of sender address + TAP aggregator pairs. Your indexer will accept business only from the senders you add in
  that list. The value provided in the table above only lists the E&N gateway for now.

### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `mainnet:<ethereum-json-rpc-url>`   |
| `ipfs`               | `--ipfs`         | `https://ipfs.network.thegraph.com` |
