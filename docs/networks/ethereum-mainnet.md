# Mainnet Configuration

Network information can be found at https://thegraph.com/explorer?chain=mainnet. The Graph Network mainnet is open for everyone to participate in as an indexer. The only requirement is a minimum stake of 100k GRT.

## Latest Releases

| Component       | Release                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| contracts       | [1.11.1](https://github.com/graphprotocol/contracts/releases/tag/v1.11.1)    |
| indexer-agent   | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)    |
| indexer-cli     | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)    |
| indexer-service | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)    |
| graph-node      | [0.33.0](https://github.com/graphprotocol/graph-node/releases/tag/v0.33.0)   |

## Network Parameters

| Parameter                   | Value                 |
| --------------------------- | --------------------  |
| Epoch length                | ~ 24h (6646 blocks)   |
| Maximum allocation lifetime | ~28 days (28 epochs)  |

## Contracts & accounts

| Name               | Address                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Graph Token (GRT)  | [`0xc944E90C64B2c07662A292be6244BDf05Cda44a7`](https://etherscan.io/address/0xc944e90c64b2c07662a292be6244bdf05cda44a7) |
| Staking            | [`0xF55041E37E12cD407ad00CE2910B8269B01263b9`](https://etherscan.io/address/0xF55041E37E12cD407ad00CE2910B8269B01263b9) |
| Data Edge          | [`0xADE906194C923b28F03F48BC5D9D987AAE21fFab`](https://etherscan.io/address/0xADE906194C923b28F03F48BC5D9D987AAE21fFab) |
| Block Oracle Owner | [`0xeb4ad97a099defc85c900a60adfd2405c455b2c0`](https://etherscan.io/address/0xeb4ad97a099defc85c900a60adfd2405c455b2c0) |

Other network contracts can be found in [graphprotocol/contracts](https://github.com/graphprotocol/contracts/blob/dev/addresses.json).

## Configuration

### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                                              |
| ------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Ethereum mainnet node/provider                                                  |
| `INDEXER_AGENT_ETHEREUM_NETWORK`            | `--ethereum-network`            | `mainnet`                                                                          |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of mainnet indexer                                                |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of mainnet indexer infrastructure                                  |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for mainnet operator                                             |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmfVipKy3sKva3vYQW8vesh5xPirEPyoKybPY5pfLGcjSS`                                   |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-mainnet`                                             |
| `INDEXER_AGENT_DAI_CONTRACT`                | `--dai-contract`                | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` (USDC)                                |
| `INDEXER_AGENT_COLLECT_RECEIPTS_ENDPOINT`   | `--collect-receipts-endpoint`   | `https://gateway.network.thegraph.com/collect-receipts`                            |
| `INDEXER_AGENT_GAS_PRICE_MAX`               | `--gas-price-max`               | `50`                                                                               |
| `INDEXER_AGENT_EPOCH_SUBGRAPH_ENDPOINT`     | `--epoch-subgraph-endpoint`     | `https://api.thegraph.com/subgraphs/name/graphprotocol/mainnet-epoch-block-oracle` |

In order to avoid collecting or claiming query fees below a certain threshold
(e.g. below the cost of the two transactions), the following configuration
option can be used.

| Environment Variable                         | CLI Argument                      | Value                                                                                     |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_REBATE_CLAIM_THRESHOLD`       | `--rebate-claim-threshold`        | Minimum rebate (in GRT) received for an allocation to claim (Default: 200)                |
| `INDEXER_AGENT_REBATE_CLAIM_BATCH_THRESHOLD` | `--rebate-claim-batch-threshold`  | Minimum total rebates (in GRT) before a batched claim is processed (Default: 2000)        |
| `INDEXER_AGENT_VOUCHER_EXPIRATION`           | `--voucher-expiration`            | Time (in seconds) to permanently delete vouchers with too few query fees  (Default: 2160) |            

### Indexer Service

| Environment Variable                          | CLI Argument                    | Value                                            |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| `INDEXER_SERVICE_ETHEREUM`                    | `--ethereum`                    | An Ethereum mainnet node/provider                |
| `INDEXER_SERVICE_ETHEREUM_NETWORK`            | `--ethereum-network`            | `mainnet`                                        |
| `INDEXER_SERVICE_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of mainnet indexer              |
| `INDEXER_SERVICE_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for mainnet operator           |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmfVipKy3sKva3vYQW8vesh5xPirEPyoKybPY5pfLGcjSS` |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-mainnet`           |
| `INDEXER_SERVICE_CLIENT_SIGNER_ADDRESS`       | `--client-signer-address`       | `0x982D10c56b8BBbD6e09048F5c5f01b43C65D5aE0`     |

### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `mainnet:<ethereum-json-rpc-url>`   |
| `ipfs`               | `--ipfs`         | `https://ipfs.network.thegraph.com` |

