# Arbitrum One Configuration

Network information can be found at https://thegraph.com/explorer?chain=arbitrum-one. The Graph Network mainnet is open for everyone to participate in as an indexer. The only requirement is a minimum stake of 100k GRT.

## Latest Releases

| Component       | Release                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| contracts       | [1.11.1](https://github.com/graphprotocol/contracts/releases/tag/v1.11.1)    |
| indexer-agent   | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)    |
| indexer-cli     | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)    |
| indexer-service | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)    |
| graph-node      | [0.34.0](https://github.com/graphprotocol/graph-node/releases/tag/v0.34.0)   |

## Network Parameters

| Parameter                   | Value                 |
| --------------------------- | --------------------  |
| Epoch length                | ~ 24h (6646 blocks)   |
| Maximum allocation lifetime | ~28 days (28 epochs)  |

## Contracts & accounts

| Name               | Address                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Graph Token (GRT)  | [`0x9623063377AD1B27544C965cCd7342f7EA7e88C7`](https://arbiscan.io/address/0x9623063377AD1B27544C965cCd7342f7EA7e88C7) |
| Staking            | [`0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03`](https://arbiscan.io/address/0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03) |
| Data Edge          | [`0x633bb9790d7c4c59991cebd377c0ed6501a35ebe`](https://arbiscan.io/address/0x633bb9790d7c4c59991cebd377c0ed6501a35ebe) |
| Block Oracle Owner | [`0x5f49491e965895ded343af13389ee45ef60ed793`](https://arbiscan.io/address/0x5f49491e965895ded343af13389ee45ef60ed793) |

Other network contracts can be found in [graphprotocol/contracts](https://github.com/graphprotocol/contracts/blob/dev/addresses.json#L752).

## Configuration

### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                                               |
| ------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------    |
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Arbitrum mainnet node/provider                                                   |
| `INDEXER_AGENT_ETHEREUM_NETWORK`            | `--ethereum-network`            | `arbitrum-one`                                                                          |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of mainnet indexer                                                 |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of mainnet indexer infrastructure                                   |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for mainnet operator                                              |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmSWxvd8SaQK6qZKJ7xtfxCCGoRzGnoi2WNzmJYYJW9BXY`                                    |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp`      |
| `INDEXER_AGENT_DAI_CONTRACT`                | `--dai-contract`                | TBD                                                                                 |
| `INDEXER_AGENT_COLLECT_RECEIPTS_ENDPOINT`   | `--collect-receipts-endpoint`   | `https://gateway-arbitrum.network.thegraph.com/collect-receipts`                             |
| `INDEXER_AGENT_GAS_PRICE_MAX`               | `--gas-price-max`               | `50`                                                                                |
| `INDEXER_AGENT_EPOCH_SUBGRAPH_ENDPOINT`     | `--epoch-subgraph-endpoint`     | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/4KFYqUWRTZQ9gn7GPHC6YQ2q15chJfVrX43ezYcwkgxB` |


In order to avoid collecting or claiming query fees below a certain threshold
(e.g. below the cost of the two transactions), the following configuration
option can be used.

| Environment Variable                         | CLI Argument                      | Value                                                                                     |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_REBATE_CLAIM_THRESHOLD`       | `--rebate-claim-threshold`        | Minimum rebate (in GRT) received for an allocation to claim (Default: 1)                |
| `INDEXER_AGENT_REBATE_CLAIM_BATCH_THRESHOLD` | `--rebate-claim-batch-threshold`  | Minimum total rebates (in GRT) before a batched claim is processed (Default: 5)        |
| `INDEXER_AGENT_VOUCHER_EXPIRATION`           | `--voucher-expiration`            | Time (in seconds) to permanently delete vouchers with too few query fees  (Default: 2160) |

### Indexer Service

| Environment Variable                          | CLI Argument                    | Value                                                                                    |
| --------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `INDEXER_SERVICE_ETHEREUM`                    | `--ethereum`                    | An Arbitrum mainnet node/provider                                                        |
| `INDEXER_SERVICE_ETHEREUM_NETWORK`            | `--ethereum-network`            | `arbitrum-one`                                                                               |
| `INDEXER_SERVICE_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of mainnet indexer                                                      |
| `INDEXER_SERVICE_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for mainnet operator                                                   |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmSWxvd8SaQK6qZKJ7xtfxCCGoRzGnoi2WNzmJYYJW9BXY`                                         |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp`           |
| `INDEXER_SERVICE_CLIENT_SIGNER_ADDRESS`       | `--client-signer-address`       | `0xc483960d4D58eabc434Dc88a620AdFd883D6Dd4e`                                             |

### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `mainnet:<ethereum-json-rpc-url>`   |
| `ipfs`               | `--ipfs`         | `https://ipfs.network.thegraph.com` |
