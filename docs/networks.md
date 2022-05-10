# Mainnet and Testnet Configuration

## Latest Releases

For mainnet:

| Component       | Release                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| contracts       | [1.2.0](https://github.com/graphprotocol/contracts/releases/tag/v1.2.0)    |
| indexer-agent   | [0.18.6](https://github.com/graphprotocol/indexer/releases/tag/v0.18.6)    |
| indexer-cli     | [0.18.6](https://github.com/graphprotocol/indexer/releases/tag/v0.18.6)    |
| indexer-service | [0.18.6](https://github.com/graphprotocol/indexer/releases/tag/v0.18.6)    |
| graph-node      | [0.26.0](https://github.com/graphprotocol/graph-node/releases/tag/v0.26.0) |

For testnet:

| Component       | Release                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| contracts       | [1.2.0](https://github.com/graphprotocol/contracts/releases/tag/v1.2.0)    |
| indexer-agent   | [0.19.0](https://github.com/graphprotocol/indexer/releases/tag/v0.19.0)    |
| indexer-cli     | [0.19.0](https://github.com/graphprotocol/indexer/releases/tag/v0.19.0)    |
| indexer-service | [0.19.0](https://github.com/graphprotocol/indexer/releases/tag/v0.19.0)    |
| graph-node      | [0.26.0](https://github.com/graphprotocol/graph-node/releases/tag/v0.26.0) |

## Mainnet (https://network.thegraph.com)

### Registration / Funding (GRT)

The Graph Network mainnet is open for everyone to participate in as an
indexer. The only requirement is a minimum stake of 100k GRT.

### Network Parameters

| Parameter                   | Value |
| --------------------------- | ----- |
| Epoch length                | ~ 24h |
| Maximum allocation lifetime | ~ 28d |

### Contracts

| Contract          | Address                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Graph Token (GRT) | [`0xc944E90C64B2c07662A292be6244BDf05Cda44a7`](https://etherscan.io/address/0xc944e90c64b2c07662a292be6244bdf05cda44a7) |
| Staking           | [`0xF55041E37E12cD407ad00CE2910B8269B01263b9`](https://etherscan.io/address/0xF55041E37E12cD407ad00CE2910B8269B01263b9) |

### Configuration

#### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                   |
| ------------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Ethereum mainnet node/provider                       |
| `INDEXER_AGENT_ETHEREUM_NETWORK`            | `--ethereum-network`            | `mainnet`                                               |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of mainnet indexer                     |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of mainnet indexer infrastructure       |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for mainnet operator                  |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmTePWCvPedmVxAvPnDFmFVxxYNW73z6xisyKCL2xa5P6e`        |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://gateway.thegraph.com/network`                  |
| `INDEXER_AGENT_DAI_CONTRACT`                | `--dai-contract`                | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` (USDC)     |
| `INDEXER_AGENT_COLLECT_RECEIPTS_ENDPOINT`   | `--collect-receipts-endpoint`   | `https://gateway.network.thegraph.com/collect-receipts` |
| `INDEXER_AGENT_GAS_PRICE_MAX`               | `--gas-price-max`               | `50`                                                    |

In order to avoid collecting or claiming query fees below a certain threshold
(e.g. below the cost of the two transactions), the following configuration
option can be used.

| Environment Variable                         | CLI Argument                      | Value                                                                                     |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_REBATE_CLAIM_THRESHOLD`       | `--rebate-claim-threshold`        | Minimum rebate (in GRT) received for an allocation to claim (Default: 200)                |
| `INDEXER_AGENT_REBATE_CLAIM_BATCH_THRESHOLD` | `--rebate-claim-batch-threshold`  | Minimum total rebates (in GRT) before a batched claim is processed (Default: 2000)        |
| `INDEXER_AGENT_VOUCHER_EXPIRATION`           | `--voucher-expiration`            | Time (in seconds) to permanently delete vouchers with too few query fees  (Default: 2160) |            

#### Indexer Service

| Environment Variable                          | CLI Argument                    | Value                                            |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| `INDEXER_SERVICE_ETHEREUM`                    | `--ethereum`                    | An Ethereum mainnet node/provider                |
| `INDEXER_SERVICE_ETHEREUM_NETWORK`            | `--ethereum-network`            | `mainnet`                                        |
| `INDEXER_SERVICE_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of mainnet indexer              |
| `INDEXER_SERVICE_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for mainnet operator           |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmTePWCvPedmVxAvPnDFmFVxxYNW73z6xisyKCL2xa5P6e` |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://gateway.thegraph.com/network`           |
| `INDEXER_SERVICE_CLIENT_SIGNER_ADDRESS`       | `--client-signer-address`       | `0x982D10c56b8BBbD6e09048F5c5f01b43C65D5aE0`     |

#### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `mainnet:<ethereum-json-rpc-url>`   |
| `ipfs`               | `--ipfs`         | `https://ipfs.network.thegraph.com` |

## Testnet (https://testnet.thegraph.com/, Rinkeby)

### Registration / Funding (GRT)

In order to participate in the testnet, you'll need Rinkeby ETH and testnet GRT.
To be eligable for testnet GRT, you'll need to

1. join [The Graph Discord](https://thegraph.com/discord/),
2. get the `@testnetindexer` role in the `#roles` channel,
3. use the `#testnet-fauceet` channel to obtain testnet GRT.

### Approving And Staking

To approve your testnet GRT to be spent through the staking contract, first approve
it in the GRT contract:

```bash
git clone https://github.com/graphprotocol/contracts
cd contracts

 # If you haven't done this before:
npm install
npm run compile

./cli/cli.ts -m <indexer-mnemonic> -p <ethereum-rinkeby-node> \
  contracts graphToken approve --account 0x2d44C0e097F6cD0f514edAC633d82E01280B4A5c --amount <grt>
```

Afterwards, stake this amount:

```bash
git clone https://github.com/graphprotocol/contracts
cd contracts
npm install # if you haven't done this before

./cli/cli.ts -m <indexer-mnemonic> -p <ethereum-rinkeby-node> \
  contracts staking stake --amount <grt>
```

### Setting An Operator

To set an operator for your testnet indexer, you can use the contracts CLI as follows.
This is similar to using Remix, except it's easier.

```bash
git clone https://github.com/graphprotocol/contracts
cd contracts

 # If you haven't done this before:
npm install
npm run compile

./cli/cli.ts -m <indexer-mnemonic> -p <ethereum-rinkeby-node> \
  contracts staking setOperator --operator <operator-address> --allowed true
```

### Network Parameters

| Parameter                   | Value |
| --------------------------- | ----- |
| Epoch length                | ~ 4h  |
| Maximum allocation lifetime | ~ 1d  |

### Contracts

| Contract          | Address                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Graph Token (GRT) | [`0x54Fe55d5d255b8460fB3Bc52D5D676F9AE5697CD`](https://rinkeby.etherscan.io/address/0x54Fe55d5d255b8460fB3Bc52D5D676F9AE5697CD) |
| Staking           | [`0x2d44C0e097F6cD0f514edAC633d82E01280B4A5c`](https://rinkeby.etherscan.io/address/0x2d44C0e097F6cD0f514edAC633d82E01280B4A5c) |

### Configuration

The Graph testnet contracts live on rinkeby, but the subgraphs used in the
testnet (for now) are all mainnet subgraphs. This means:

- Indexer Agent and Indexer Service must connect to rinkeby
- Graph Node must connect to at least one mainnet Ethereum node/provider

#### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                   |
| ------------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Ethereum rinkeby node/provider                       |
| `INDEXER_AGENT_ETHEREUM_NETWORK`            | `--ethereum-network`            | `rinkeby`                                               |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of testnet indexer                     |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of testnet indexer infrastructure       |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for testnet operator                  |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmYQTw2f22picV7DToxbSfmdvXEhn9BU3JEpKvrQ1MVutf`        |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://gateway.testnet.thegraph.com/network`          |
| `INDEXER_AGENT_DAI_CONTRACT`                | `--dai-contract`                | `0x9e7e607afd22906f7da6f1ec8f432d6f244278be` (GDAI)     |
| `INDEXER_AGENT_COLLECT_RECEIPTS_ENDPOINT`   | `--collect-receipts-endpoint`   | `https://gateway.testnet.thegraph.com/collect-receipts` |

In order to avoid collecting or claiming query fees below a certain threshold
(e.g. below the cost of the two transactions), the following configuration
option can be used.

| Environment Variable                         | CLI Argument                      | Value                                                                                     |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_REBATE_CLAIM_THRESHOLD`       | `--rebate-claim-threshold`        | Minimum rebate (in GRT) received for an allocation to claim (Default: 200)                |
| `INDEXER_AGENT_REBATE_CLAIM_BATCH_THRESHOLD` | `--rebate-claim-batch-threshold`  | Minimum total rebates (in GRT) before a batched claim is processed (Default: 2000)        |
| `INDEXER_AGENT_VOUCHER_EXPIRATION`           | `--voucher-expiration`            | Time (in seconds) to permanently delete vouchers with too few query fees  (Default: 2160) |

#### Indexer Service

| Environment Variable                          | CLI Argument                    | Value                                            |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| `INDEXER_SERVICE_ETHEREUM`                    | `--ethereum`                    | An Ethereum rinkeby node/provider                |
| `INDEXER_SERVICE_ETHEREUM_NETWORK`            | `--ethereum-network`            | `rinkeby`                                        |
| `INDEXER_SERVICE_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of testnet indexer              |
| `INDEXER_SERVICE_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for testnet operator           |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmYQTw2f22picV7DToxbSfmdvXEhn9BU3JEpKvrQ1MVutf` |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://gateway.testnet.thegraph.com/network`   |
| `INDEXER_SERVICE_CLIENT_SIGNER_ADDRESS`       | `--client-signer-address`       | `0xe1EC4339019eC9628438F8755f847e3023e4ff9c`     |

#### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `mainnet:...`                       |
| `ipfs`               | `--ipfs`         | `https://ipfs.network.thegraph.com` |
