# Mainnet and Testnet Configuration

## Latest Releases

For mainnet:

| Component       | Release                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| contracts       | [1.11.1](https://github.com/graphprotocol/contracts/releases/tag/v1.11.1)    |
| indexer-agent   | [0.18.6](https://github.com/graphprotocol/indexer/releases/tag/v0.18.6)    |
| indexer-cli     | [0.18.6](https://github.com/graphprotocol/indexer/releases/tag/v0.18.6)    |
| indexer-service | [0.18.6](https://github.com/graphprotocol/indexer/releases/tag/v0.18.6)    |
| graph-node      | [0.28.0](https://github.com/graphprotocol/graph-node/releases/tag/v0.28.0) |

For testnet:

| Component       | Release                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| contracts       | [1.13.0](https://github.com/graphprotocol/contracts/releases/tag/v1.13.0)    |
| indexer-agent   | [0.20.3](https://github.com/graphprotocol/indexer/releases/tag/v0.20.3)    |
| indexer-cli     | [0.20.3](https://github.com/graphprotocol/indexer/releases/tag/v0.20.3)    |
| indexer-service | [0.20.3](https://github.com/graphprotocol/indexer/releases/tag/v0.20.3)    |
| graph-node      | [0.28.0](https://github.com/graphprotocol/graph-node/releases/tag/v0.28.0) |

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
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmV614UpBCpuusv5MsismmPYu4KqLtdeNMKpiNrX56kw6u`        |
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
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmV614UpBCpuusv5MsismmPYu4KqLtdeNMKpiNrX56kw6u` |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://gateway.thegraph.com/network`           |
| `INDEXER_SERVICE_CLIENT_SIGNER_ADDRESS`       | `--client-signer-address`       | `0x982D10c56b8BBbD6e09048F5c5f01b43C65D5aE0`     |

#### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `mainnet:<ethereum-json-rpc-url>`   |
| `ipfs`               | `--ipfs`         | `https://ipfs.network.thegraph.com` |

## Testnet (https://testnet.thegraph.com/, Goerli)

### Registration / Funding (GRT)

In order to participate in the testnet, you'll need Goerli ETH and GRT.
To be eligible for testnet GRT, you'll need to

1. join [The Graph Discord](https://thegraph.com/discord/),
2. get the `@testnetindexer` role in the `#roles` channel,
3. use the `#testnet-goerli-faucet` channel to obtain testnet GRT.

### Approving And Staking

#### Via Graph Explorer

The Graph Explorer provides an easy way to approve and stake your GRT as an indexer via a web GUI. 

1. Navigate to [the testnet explorer](https://testnet.thegraph.com/)
2. Login with Metamask and select the `Goerli` network
3. Navigate to your profile (click your address/avatar at top right)
4. Select the `Indexing` tab and hit the `Stake` button
5. Follow the directions on the staking screen to stake the desired amount 

### Via the Contracts CLI

To approve your testnet GRT to be spent through the staking contract, first approve
it in the GRT contract:

```bash
git clone https://github.com/graphprotocol/contracts
cd contracts

 # If you haven't done this before:
npm install
npm run compile

./cli/cli.ts -m <indexer-mnemonic> -p <ethereum-goerli-node> \
  contracts graphToken approve --account 0x35e3Cb6B317690d662160d5d02A5b364578F62c9 --amount <grt>
```

Afterwards, stake this amount:

```bash
./cli/cli.ts -m <indexer-mnemonic> -p <ethereum-goerli-node> \
  contracts staking stake --amount <grt>
```

### Setting An Operator

#### Via Graph Explorer

1. Navigate to [the testnet explorer](https://testnet.thegraph.com/)
2. Login with Metamask and select the `Goerli` network
3. Navigate to your settings page (click profile dropdown at top right and select ⚙️ `Settings`)
4. Navigate to the `Operators` settings (click `Operators` button)
5. Click `+` to add your operator wallet address
6. Follow instructions to submit transaction

### Via the Contracts CLI

```bash
./cli/cli.ts -m <indexer-mnemonic> -p <ethereum-goerli-node> \
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
| Graph Token (GRT) | [`0x5c946740441C12510a167B447B7dE565C20b9E3C`](https://goerli.etherscan.io/address/0x5c946740441C12510a167B447B7dE565C20b9E3C) |
| Staking           | [`0x35e3Cb6B317690d662160d5d02A5b364578F62c9`](https://goerli.etherscan.io/address/0x35e3Cb6B317690d662160d5d02A5b364578F62c9) |

### Configuration

The Graph testnet contracts live on Goerli, but many of the subgraphs used in the
testnet (for now) are Mainnet subgraphs. This means:

- Indexer Agent and Indexer Service must connect to Goerli
- Graph Node must connect to at least one Mainnet Ethereum node/provider

#### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                   |
| ------------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Ethereum Goerli node/provider                       |
| `INDEXER_AGENT_ETHEREUM_NETWORK`            | `--ethereum-network`            | `goerli`                                               |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of testnet indexer                     |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of testnet indexer infrastructure       |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for testnet operator                  |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmPVz18RFwK6hE5rZFWERk23LgrTBz2FCkZzgPSrFxFWN4`        |
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
| `INDEXER_SERVICE_ETHEREUM`                    | `--ethereum`                    | An Ethereum Goerli node/provider                |
| `INDEXER_SERVICE_ETHEREUM_NETWORK`            | `--ethereum-network`            | `goerli`                                        |
| `INDEXER_SERVICE_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of testnet indexer              |
| `INDEXER_SERVICE_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for testnet operator           |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_DEPLOYMENT` | `--network-subgraph-deployment` | `QmPVz18RFwK6hE5rZFWERk23LgrTBz2FCkZzgPSrFxFWN4` |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://gateway.testnet.thegraph.com/network`   |
| `INDEXER_SERVICE_CLIENT_SIGNER_ADDRESS`       | `--client-signer-address`       | `0xe1EC4339019eC9628438F8755f847e3023e4ff9c`     |

#### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `mainnet:...`                       |
| `ipfs`               | `--ipfs`         | `https://ipfs.network.thegraph.com` |
