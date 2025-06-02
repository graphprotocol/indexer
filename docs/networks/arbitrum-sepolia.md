# Testnet Configuration

The Graph Network's testnet is on Arbitrum Sepolia (eip155:421614). Sepolia network information can be found at https://testnet.thegraph.com/explorer?chain=arbitrum-sepolia.

## Latest Releases

| Component          | Release                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| contracts          | [5.3.3](https://github.com/graphprotocol/contracts/releases/tag/v5.3.3)              |
| indexer-agent      | [0.23.8](https://github.com/graphprotocol/indexer/releases/tag/v0.23.8)              |
| indexer-cli        | [0.23.8](https://github.com/graphprotocol/indexer/releases/tag/v0.23.8)              |
| indexer-service-rs | [1.0.0](https://github.com/graphprotocol/indexer-rs/releases/tag/v1.0.0)             |
| tap-agent          | [1.0.0](https://github.com/graphprotocol/indexer-rs/releases/tag/v1.0.0)             |
| graph-node         | [0.35.1](https://github.com/graphprotocol/graph-node/releases/tag/v0.35.1)           |

## Network Parameters

| Parameter                   | Value             |
| --------------------------- | ----------------- |
| Epoch length                | ~ 2h (554 blocks) |
| Maximum allocation lifetime | ~ 9h (4 epochs)   |

## Contracts & accounts

| Name               | Address                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Graph Token (GRT)  | [`0xf8c05dCF59E8B28BFD5eed176C562bEbcfc7Ac04`](https://sepolia.arbiscan.io/address/0xf8c05dCF59E8B28BFD5eed176C562bEbcfc7Ac04) |
| Staking            | [`0x865365C425f3A593Ffe698D9c4E6707D14d51e08`](https://sepolia.arbiscan.io/address/0x865365C425f3A593Ffe698D9c4E6707D14d51e08) |
| Data Edge          | [`0x9b9402939133F27c6eba81a321dfBFa1feE6714E`](https://sepolia.arbiscan.io/address/0x9b9402939133F27c6eba81a321dfBFa1feE6714E) |
| Block Oracle Owner | [`0x76BC183A6d9AC1e4C5ccb27b7D46DDf0d2cc9868`](https://sepolia.arbiscan.io/address/0x76BC183A6d9AC1e4C5ccb27b7D46DDf0d2cc9868) |
| TAP Escrow         | [`0x1e4dC4f9F95E102635D8F7ED71c5CdbFa20e2d02`](https://sepolia.arbiscan.io/address/0x1e4dC4f9F95E102635D8F7ED71c5CdbFa20e2d02) |

Other network contracts can be found in [graphprotocol/contracts](https://github.com/graphprotocol/contracts/blob/main/packages/contracts/addresses.json) and 
[semiotic-ai/timeline-aggregation-protocol-contracts](https://github.com/semiotic-ai/timeline-aggregation-protocol-contracts/blob/main/addresses.json).

## Configuration

The Graph testnet contracts live on Arbitrum Sepolia, but many of the subgraphs used in the
testnet (for now) are Mainnet subgraphs. This means:

- Indexer Agent and Indexer Service must connect to Arbitrum Sepolia
- Graph Node must connect to at least one Mainnet Ethereum node/provider

### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                                                                                   |
|---------------------------------------------|---------------------------------| ----------------------------------------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Arbitrum Sepolia node/provider                                                                                       |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of testnet indexer                                                                                     |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of testnet indexer infrastructure                                                                       |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for testnet operator                                                                                  |
| `INDEXER_AGENT_GATEWAY_ENDPOINT`            | `--gateway-endpoint`            | `https://gateway-arbitrum.testnet.thegraph.com/`                                                                        |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmXnGVrg6DvscnvJd86aHAPLGyGrkM17weMrAsFAEMmQLL`                                                                        |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/3xQHhMudr1oh69ut36G2mbzpYmYxwqCeU6wwqyCDCnqV` |
| `INDEXER_AGENT_EPOCH_SUBGRAPH_DEPLOYMENT`   | `--epoch-subgraph-deployment`   | `QmNNn48AU8CZei8sYLXrXABMHkiXAuQDvFaZHYYPryKEvF`                                                                        |
| `INDEXER_AGENT_EPOCH_SUBGRAPH_ENDPOINT`     | `--epoch-subgraph-endpoint`     | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/BhnsdeZihU4SuokxZMLF4FQBVJ3jgtZf6v51gHvz3bSS` |
| `INDEXER_AGENT_TAP_SUBGRAPH_DEPLOYMENT`     | `--tap-subgraph-deployment`     | `QmUiLdbsk6c51UMdcNBxsP3KadJpkmp6a3k2NCprR4ZFeM`                                                                        |
| `INDEXER_AGENT_TAP_SUBGRAPH_ENDPOINT`       | `--tap-subgraph-endpoint`       | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/7ubx365MiqBH5iUz6XWXWT8PTof5BVAyEzdb8m17RvbD` |
| `INDEXER_AGENT_IPFS_ENDPOINT` | `--ipfs-endpoint` | `https://ipfs.network.thegraph.com` |

In order to avoid collecting or claiming query fees below a certain threshold
(e.g. below the cost of the two transactions), the following configuration
option can be used.

| Environment Variable                         | CLI Argument                     | Value                                                                                    |
| -------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_REBATE_CLAIM_THRESHOLD`       | `--rebate-claim-threshold`       | Minimum rebate (in GRT) received for an allocation to claim (Default: 1)                 |
| `INDEXER_AGENT_REBATE_CLAIM_BATCH_THRESHOLD` | `--rebate-claim-batch-threshold` | Minimum total rebates (in GRT) before a batched claim is processed (Default: 5)          |
| `INDEXER_AGENT_VOUCHER_EXPIRATION`           | `--voucher-expiration`           | Time (in seconds) to permanently delete vouchers with too few query fees (Default: 2160) |

### Indexer Service rs *and* TAP Agent

They are configured using a TOML file provided with `--config`. You should start with [the minimal config example](https://github.com/graphprotocol/indexer-rs/blob/main/config/minimal-config-example.toml). You can find the full config [here](https://github.com/graphprotocol/indexer-rs/blob/main/config/maximal-config-example.toml) and the default values 
[here](https://github.com/graphprotocol/indexer-rs/blob/main/config/default_values.toml).

| Variable                               | Value                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `indexer.indexer_address`              | Ethereum address of testnet indexer                                                                                     |
| `indexer.operator_mnemonic`            | Ethereum mnemonic for testnet operator                                                                                  |
| `subgraphs.network.deployment_id`      | `QmXnGVrg6DvscnvJd86aHAPLGyGrkM17weMrAsFAEMmQLL`                                                                        |
| `subgraphs.network.query_url`          | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/3xQHhMudr1oh69ut36G2mbzpYmYxwqCeU6wwqyCDCnqV` |
| `subgraphs.escrow.deployment_id`       | `QmUiLdbsk6c51UMdcNBxsP3KadJpkmp6a3k2NCprR4ZFeM`                                                                        |
| `subgraphs.escrow.query_url`           | `https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/7ubx365MiqBH5iUz6XWXWT8PTof5BVAyEzdb8m17RvbD` |
| `blockchain.receipts_verifier_address` | `0xfC24cE7a4428A6B89B52645243662A02BA734ECF`                                                                            |
| `tap.sender_aggregator_endpoints`      | `0xC3dDf37906724732FfD748057FEBe23379b0710D = https://tap-aggregator.testnet.thegraph.com`                              |

Notes:
- You can supply those nested values using environment variables as such: `indexer.indexer_address` -> `INDEXER_SERVICE_INDEXER__INDEXER_ADDRESS` (mind the double `_`)
- `tap.sender_aggregator_endpoints` takes a key-value list of sender address + TAP aggregator pairs. Your indexer will accept business only from the senders you add in
  that list. The value provided in the table above only lists the E&N gateway for now.

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
