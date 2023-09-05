# Testnet Configuration

The Graph Network's testnet is on Goerli. Goerli network information can be found at https://testnet.thegraph.com/explorer?chain=arbitrum-goerli.

## Latest Releases

| Component       | Release                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| contracts       | [1.13.0](https://github.com/graphprotocol/contracts/releases/tag/v1.13.0)            |
| indexer-agent   | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)            |
| indexer-cli     | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)            |
| indexer-service | [0.20.16](https://github.com/graphprotocol/indexer/releases/tag/v0.20.16)            |
| graph-node      | [v0.32.0-rc.0](https://github.com/graphprotocol/graph-node/releases/tag/v0.32.0-rc.0)|

## Network Parameters

| Parameter                   | Value             |
| --------------------------- | ----------------- |
| Epoch length                | ~ 2h (554 blocks) |
| Maximum allocation lifetime | ~ 9h (4 epochs)   |

## Contracts & accounts

| Name               | Address                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Graph Token (GRT ) | [`0x18C924BD5E8b83b47EFaDD632b7178E2Fd36073D`](https://goerli.arbiscan.io/address/0x18C924BD5E8b83b47EFaDD632b7178E2Fd36073D) |
| Staking            | [`0xcd549d0C43d915aEB21d3a331dEaB9B7aF186D26`](https://goerli.arbiscan.io/address/0xcd549d0C43d915aEB21d3a331dEaB9B7aF186D26) |
| Data Edge          | [``](https://goerli.arbiscan.io/address/) |
| Block Oracle Owner | [``](https://goerli.arbiscan.io/address/) |

Other network contracts can be found in [graphprotocol/contracts](https://github.com/graphprotocol/contracts/blob/dev/addresses.json#L971).

## Configuration

The Graph testnet contracts live on Goerli, but many of the subgraphs used in the
testnet (for now) are Mainnet subgraphs. This means:

- Indexer Agent and Indexer Service must connect to Goerli
- Graph Node must connect to at least one Mainnet Ethereum node/provider

### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                                                       |
| ------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Arbitrum Goerli node/provider                                                            |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Address of testnet indexer                                                         |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of testnet indexer infrastructure                                           |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Mnemonic for testnet operator                                                      |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmTWLwhFsDdi4MuhDQzNuTsGC6WBRKk9NeQL6nRz8yTari`                                            |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-arbitrum-goerli`       |
| `INDEXER_AGENT_DAI_CONTRACT`                | `--dai-contract`                | TBD                                                                                         |
| `INDEXER_AGENT_COLLECT_RECEIPTS_ENDPOINT`   | `--collect-receipts-endpoint`   | `https://gateway-testnet-arbitrum.network.thegraph.com/collect-receipts`                    |
| `INDEXER_AGENT_GAS_PRICE_MAX`               | `--gas-price-max`               | `50`                                                                                        |
| `INDEXER_AGENT_EPOCH_SUBGRAPH_ENDPOINT`     | `--epoch-subgraph-endpoint`     | `https://api.thegraph.com/subgraphs/name/graphprotocol/arb-goerli-epoch-block-oracle`       |

In order to avoid collecting or claiming query fees below a certain threshold
(e.g. below the cost of the two transactions), the following configuration
option can be used.

| Environment Variable                         | CLI Argument                      | Value                                                                                     |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_REBATE_CLAIM_THRESHOLD`       | `--rebate-claim-threshold`        | Minimum rebate (in GRT) received for an allocation to claim (Default: 200)                |
| `INDEXER_AGENT_REBATE_CLAIM_BATCH_THRESHOLD` | `--rebate-claim-batch-threshold`  | Minimum total rebates (in GRT) before a batched claim is processed (Default: 2000)        |
| `INDEXER_AGENT_VOUCHER_EXPIRATION`           | `--voucher-expiration`            | Time (in seconds) to permanently delete vouchers with too few query fees  (Default: 2160) |

### Indexer Service

| Environment Variable                          | CLI Argument                    | Value                                                                                 |
|-----------------------------------------------|---------------------------------|---------------------------------------------------------------------------------------|
| `INDEXER_SERVICE_ETHEREUM`                    | `--ethereum`                    | An Arbitrum Goerli node/provider                                                      |
| `INDEXER_SERVICE_INDEXER_ADDRESS`             | `--indexer-address`             | Address of testnet indexer                                                   |
| `INDEXER_SERVICE_MNEMONIC`                    | `--mnemonic`                    | Mnemonic for testnet operator                                                |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmTWLwhFsDdi4MuhDQzNuTsGC6WBRKk9NeQL6nRz8yTari`                                      |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-arbitrum-goerli` |
| `INDEXER_SERVICE_CLIENT_SIGNER_ADDRESS`       | `--client-signer-address`       | `0xac01B0b3B2Dc5D8E0D484c02c4d077C15C96a7b4`                                          |

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
