# Testnet Configuration

The Graph Network's testnet is on Arbitrum Sepolia (eip155:421614). Sepolia network information can be found at https://testnet.thegraph.com/explorer?chain=arbitrum-sepolia.

## Latest Releases

| Component       | Release                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| contracts       | [5.3.3](https://github.com/graphprotocol/contracts/releases/tag/v5.3.3)              |
| indexer-agent   | [0.20.22](https://github.com/graphprotocol/indexer/releases/tag/v0.20.22)            |
| indexer-cli     | [0.20.22](https://github.com/graphprotocol/indexer/releases/tag/v0.20.22)            |
| indexer-service | [0.20.22](https://github.com/graphprotocol/indexer/releases/tag/v0.20.22)            |
| graph-node      | [0.35.0-rc.0](https://github.com/graphprotocol/graph-node/releases/tag/v0.35.0-rc.0) |

## Network Parameters

| Parameter                   | Value             |
| --------------------------- | ----------------- |
| Epoch length                | ~ 2h (554 blocks) |
| Maximum allocation lifetime | ~ 9h (4 epochs)   |

## Contracts & accounts

| Name               | Address                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Graph Token (GRT ) | [`0xf8c05dCF59E8B28BFD5eed176C562bEbcfc7Ac04`](https://arbiscan.io/address/0xf8c05dCF59E8B28BFD5eed176C562bEbcfc7Ac04) |
| Staking            | [`0x865365C425f3A593Ffe698D9c4E6707D14d51e08`](https://arbiscan.io/address/0x865365C425f3A593Ffe698D9c4E6707D14d51e08) |

| Data Edge | [`0x9b9402939133F27c6eba81a321dfBFa1feE6714E`](https://arbiscan.io/address/0x9b9402939133F27c6eba81a321dfBFa1feE6714E) |
| Block Oracle Owner | [`0x76BC183A6d9AC1e4C5ccb27b7D46DDf0d2cc9868`](https://arbiscan.io/address/0x76BC183A6d9AC1e4C5ccb27b7D46DDf0d2cc9868) |

Other network contracts can be found in [graphprotocol/contracts](https://github.com/graphprotocol/contracts/blob/main/addresses.json#L1220-L1425).

## Configuration

The Graph testnet contracts live on Arbitrum Sepolia, but many of the subgraphs used in the
testnet (for now) are Mainnet subgraphs. This means:

- Indexer Agent and Indexer Service must connect to Arbitrum Sepolia
- Graph Node must connect to at least one Mainnet Ethereum node/provider

### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                                                  |
| ------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Arbitrum Sepolia node/provider                                                      |
| `INDEXER_AGENT_ETHEREUM_NETWORK`            | `--ethereum-network`            | `arbitrum-sepolia`                                                                     |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of testnet indexer                                                    |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of testnet indexer infrastructure                                      |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for testnet operator                                                 |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmXnGVrg6DvscnvJd86aHAPLGyGrkM17weMrAsFAEMmQLL`                                       |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-arbitrum-sepolia` |
| `INDEXER_AGENT_DAI_CONTRACT`                | `--dai-contract`                | `0x9e7e607afd22906f7da6f1ec8f432d6f244278be` (GDAI)                                    |
| `INDEXER_AGENT_COLLECT_RECEIPTS_ENDPOINT`   | `--collect-receipts-endpoint`   | `https://gateway-arbitrum.testnet.thegraph.com/collect-receipts`                       |
| `INDEXER_AGENT_EPOCH_SUBGRAPH_ENDPOINT`     | `--epoch-subgraph-endpoint`     | `https://api.thegraph.com/subgraphs/name/graphprotocol/arbitrum-sepolia-ebo`           |

In order to avoid collecting or claiming query fees below a certain threshold
(e.g. below the cost of the two transactions), the following configuration
option can be used.

| Environment Variable                         | CLI Argument                     | Value                                                                                    |
| -------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_REBATE_CLAIM_THRESHOLD`       | `--rebate-claim-threshold`       | Minimum rebate (in GRT) received for an allocation to claim (Default: 200)               |
| `INDEXER_AGENT_REBATE_CLAIM_BATCH_THRESHOLD` | `--rebate-claim-batch-threshold` | Minimum total rebates (in GRT) before a batched claim is processed (Default: 2000)       |
| `INDEXER_AGENT_VOUCHER_EXPIRATION`           | `--voucher-expiration`           | Time (in seconds) to permanently delete vouchers with too few query fees (Default: 2160) |

### Indexer Service

| Environment Variable                          | CLI Argument                    | Value                                                                                  |
| --------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `INDEXER_SERVICE_ETHEREUM`                    | `--ethereum`                    | An Arbitrum Sepolia node/provider                                                      |
| `INDEXER_SERVICE_ETHEREUM_NETWORK`            | `--ethereum-network`            | `arbitrum-sepolia`                                                                     |
| `INDEXER_SERVICE_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of testnet indexer                                                    |
| `INDEXER_SERVICE_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for testnet operator                                                 |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmXnGVrg6DvscnvJd86aHAPLGyGrkM17weMrAsFAEMmQLL`                                       |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-arbitrum-sepolia` |
| `INDEXER_SERVICE_CLIENT_SIGNER_ADDRESS`       | `--client-signer-address`       | `0xac01B0b3B2Dc5D8E0D484c02c4d077C15C96a7b4`                                           |

### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `arbitrum-sepolia:...`              |
| `ipfs`               | `--ipfs`         | `https://ipfs.network.thegraph.com` |

## Feature support

> This defines indexing & querying features which are experimental or not fully supported for indexing & query rewards and arbitration ([read more](../feature-support-matrix.md)).

| Subgraph Feature         | Aliases          | Implemented | Experimental | Query Arbitration | Indexing Arbitration | Indexing Rewards |
| ------------------------ | ---------------- | ----------- | ------------ | ----------------- | -------------------- | ---------------- |
| **Core Features**        |                  |             |              |                   |                      |                  |
| Full-text Search         |                  | Yes         | No           | No                | Yes                  | Yes              |
| Non-Fatal Errors         |                  | Yes         | Yes          | Yes               | Yes                  | Yes              |
| Grafting                 |                  | Yes         | Yes          | Yes               | Yes                  | Yes              |
| **Data Source Types**    |                  |             |              |                   |                      |                  |
| eip155:\*                | \*               | Yes         | No           | No                | No                   | No               |
| eip155:1                 | mainnet          | Yes         | No           | Yes               | Yes                  | Yes              |
| eip155:100               | gnosis           | Yes         | No           | Yes               | Yes                  | Yes              |
| near:\*                  | \*               | Yes         | Yes          | No                | No                   | No               |
| cosmos:\*                | \*               | Yes         | Yes          | No                | No                   | No               |
| arweave:\*               | \*               | Yes         | Yes          | No                | No                   | No               |
| eip155:42161             | arbitrum-one     | Yes         | Yes          | Yes               | Yes                  | Yes              |
| eip155:42220             | celo             | Yes         | Yes          | Yes               | Yes                  | Yes              |
| eip155:43114             | avalanche        | Yes         | Yes          | Yes               | Yes                  | Yes              |
| **Data Source Features** |                  |             |              |                   |                      |                  |
| ipfs.cat in mappings     |                  | Yes         | Yes          | No                | No                   | No               |
| ENS                      |                  | Yes         | Yes          | No                | No                   | No               |
| File data sources: IPFS  |                  | Yes         | Yes          | No                | Yes                  | Yes              |
| eip155:421614            | sepolia          | Yes         | Yes          | No                | Yes                  | Yes              |
| eip155:421614            | arbitrum-sepolia | Yes         | Yes          | No                | Yes                  | Yes              |
