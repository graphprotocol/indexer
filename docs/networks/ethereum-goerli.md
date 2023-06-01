# Testnet Configuration

The Graph Network's testnet is on Goerli. Goerli network information can be found at https://testnet.thegraph.com/explorer?chain=goerli.

## Latest Releases

| Component       | Release                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| contracts       | [1.13.0](https://github.com/graphprotocol/contracts/releases/tag/v1.13.0)            |
| indexer-agent   | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)            |
| indexer-cli     | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)            |
| indexer-service | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)            |
| graph-node      | [0.31.0-rc.0](https://github.com/graphprotocol/graph-node/releases/tag/v0.31.0-rc.0) |

## Network Parameters

| Parameter                   | Value             |
| --------------------------- | ----------------- |
| Epoch length                | ~ 2h (554 blocks) |
| Maximum allocation lifetime | ~ 9h (4 epochs)   |

## Contracts & accounts

| Name               | Address                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Graph Token (GRT ) | [`0x5c946740441C12510a167B447B7dE565C20b9E3C`](https://goerli.etherscan.io/address/0x5c946740441C12510a167B447B7dE565C20b9E3C) |
| Staking            | [`0x35e3Cb6B317690d662160d5d02A5b364578F62c9`](https://goerli.etherscan.io/address/0x35e3Cb6B317690d662160d5d02A5b364578F62c9) |
| Data Edge          | [`0xc4228701A7B92793b2428687DC37D0ed92e0d7A7`](https://goerli.etherscan.io/address/0xc4228701A7B92793b2428687DC37D0ed92e0d7A7) |
| Block Oracle Owner | [`0xfA711DA0f9336f27E7B7483398cbd8F0880f259a`](https://goerli.etherscan.io/address/0xfA711DA0f9336f27E7B7483398cbd8F0880f259a) |

Other network contracts can be found in [graphprotocol/contracts](https://github.com/graphprotocol/contracts/blob/dev/addresses.json#L306).

## Configuration

The Graph testnet contracts live on Goerli, but many of the subgraphs used in the
testnet (for now) are Mainnet subgraphs. This means:

- Indexer Agent and Indexer Service must connect to Goerli
- Graph Node must connect to at least one Mainnet Ethereum node/provider

### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                                             |
| ------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Ethereum Goerli node/provider                                                  |
| `INDEXER_AGENT_ETHEREUM_NETWORK`            | `--ethereum-network`            | `goerli`                                                                          |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of testnet indexer                                               |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of testnet indexer infrastructure                                 |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for testnet operator                                            |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmeoyAr2soK1xE32Pxh1ZNXoQq75ZJwHJ7nzms3MogJUvK`                                  |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-goerli`      |
| `INDEXER_AGENT_DAI_CONTRACT`                | `--dai-contract`                | `0x9e7e607afd22906f7da6f1ec8f432d6f244278be` (GDAI)                               |
| `INDEXER_AGENT_COLLECT_RECEIPTS_ENDPOINT`   | `--collect-receipts-endpoint`   | `https://gateway.testnet.thegraph.com/collect-receipts`                           |
| `INDEXER_AGENT_EPOCH_SUBGRAPH_ENDPOINT`     | `--epoch-subgraph-endpoint`     | `https://api.thegraph.com/subgraphs/name/graphprotocol/goerli-epoch-block-oracle` |

In order to avoid collecting or claiming query fees below a certain threshold
(e.g. below the cost of the two transactions), the following configuration
option can be used.

| Environment Variable                         | CLI Argument                      | Value                                                                                     |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_REBATE_CLAIM_THRESHOLD`       | `--rebate-claim-threshold`        | Minimum rebate (in GRT) received for an allocation to claim (Default: 200)                |
| `INDEXER_AGENT_REBATE_CLAIM_BATCH_THRESHOLD` | `--rebate-claim-batch-threshold`  | Minimum total rebates (in GRT) before a batched claim is processed (Default: 2000)        |
| `INDEXER_AGENT_VOUCHER_EXPIRATION`           | `--voucher-expiration`            | Time (in seconds) to permanently delete vouchers with too few query fees  (Default: 2160) |

### Indexer Service

| Environment Variable                          | CLI Argument                    | Value                                                                           |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `INDEXER_SERVICE_ETHEREUM`                    | `--ethereum`                    | An Ethereum Goerli node/provider                                                |
| `INDEXER_SERVICE_ETHEREUM_NETWORK`            | `--ethereum-network`            | `goerli`                                                                        |
| `INDEXER_SERVICE_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of testnet indexer                                             |
| `INDEXER_SERVICE_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for testnet operator                                          |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmeoyAr2soK1xE32Pxh1ZNXoQq75ZJwHJ7nzms3MogJUvK`                                |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-goerli`    |
| `INDEXER_SERVICE_CLIENT_SIGNER_ADDRESS`       | `--client-signer-address`       | `0xe1EC4339019eC9628438F8755f847e3023e4ff9c`                                    |

### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `mainnet:...`                       |
| `ipfs`               | `--ipfs`         | `https://ipfs.network.thegraph.com` |

## Feature support

> This defines indexing & querying features which are experimental or not fully supported for indexing & query rewards and arbitration ([read more](../feature-support-matrix.md)).

| Subgraph Feature         | Aliases | Implemented | Experimental | Query Arbitration | Indexing Arbitration | Indexing Rewards |
|--------------------------|---------|-------------|--------------|-------------------|----------------------|------------------|
| **Core Features**        |         |             |              |                   |                      |                  |
| Full-text Search         |         | Yes         | No           | No                | Yes                  | Yes              |
| Non-Fatal Errors         |         | Yes         | Yes          | Yes               | Yes                  | Yes              |
| Grafting                 |         | Yes         | Yes          | Yes               | Yes                  | Yes              |
| **Data Source Types**    |         |             |              |                   |                      |                  |
| eip155:*                 | *       | Yes         | No           | No                | No                   | No               |
| eip155:1                 | mainnet | Yes         | No           | Yes               | Yes                  | Yes              |
| eip155:100               | gnosis  | Yes         | No           | Yes               | Yes                  | Yes              |
| near:*                   | *       | Yes         | Yes          | No                | No                   | No               |
| cosmos:*                 | *       | Yes         | Yes          | No                | No                   | No               |
| arweave:*                | *       | Yes         | Yes          | No                | No                   | No               |
| eip155:42161             | arbitrum-one  | Yes   | Yes          | Yes               | Yes                  | Yes              |
| eip155:42220             | celo    | Yes         | Yes          | Yes               | Yes                  | Yes              |
| eip155:43114             | avalanche | Yes       | Yes          | Yes               | Yes                  | Yes              |
| **Data Source Features** |         |             |              |                   |                      |                  |
| ipfs.cat in mappings     |         | Yes         | Yes          | No                | No                   | No               |
| ENS                      |         | Yes         | Yes          | No                | No                   | No               |
| File data sources: IPFS  |         | Yes         | Yes          | No                | Yes                  | Yes              |
