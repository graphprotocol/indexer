# Mainnet and Testnet Configuration

## Latest Releases

For mainnet:

| Component       | Release                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| contracts       | [1.2.0](https://github.com/graphprotocol/contracts/releases/tag/v1.2.0)    |
| indexer-agent   | [0.10.0](https://github.com/graphprotocol/indexer/releases/tag/v0.10.0)    |
| indexer-cli     | [0.10.0](https://github.com/graphprotocol/indexer/releases/tag/v0.10.0)    |
| indexer-service | [0.10.0](https://github.com/graphprotocol/indexer/releases/tag/v0.10.0)    |
| graph-node      | [0.21.1](https://github.com/graphprotocol/graph-node/releases/tag/v0.21.1) |

For testnet:

| Component       | Release                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contracts       | [1.2.0](https://github.com/graphprotocol/contracts/releases/tag/v1.2.0)                                                                                                |
| indexer-agent   | [0.11.0](https://github.com/graphprotocol/indexer/releases/tag/v0.11.0)                                                                                                |
| indexer-cli     | [0.11.0](https://github.com/graphprotocol/indexer/releases/tag/v0.11.0)                                                                                                |
| indexer-service | [0.11.0](https://github.com/graphprotocol/indexer/releases/tag/v0.11.0)                                                                                                |
| graph-node      | [0.22.0](https://github.com/graphprotocol/graph-node/releases/tag/v0.22.0)                                                                                             |
| vector_node     | [0.2.1](https://hub.docker.com/layers/connextproject/vector_node/0.2.1/images/sha256-81e3bf9aac77c775de84b50935249db4e4631b34c2ab7077bcb812532ba745b8?context=explore) |

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

| Environment Variable                      | CLI Argument                  | Value                                               |
| ----------------------------------------- | ----------------------------- | --------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                  | `--ethereum`                  | An Ethereum mainnet node/provider                   |
| `INDEXER_AGENT_ETHEREUM_NETWORK`          | `--ethereum-network`          | `1`                                                 |
| `INDEXER_AGENT_INDEXER_ADDRESS`           | `--indexer-address`           | Ethereum address of mainnet indexer                 |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`   | `--indexer-geo-coordinates`   | Geo coordinates of mainnet indexer infrastructure   |
| `INDEXER_AGENT_MNEMONIC`                  | `--mnemonic`                  | Ethereum mnemonic for mainnet operator              |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT` | `--network-subgraph-endpoint` | `https://gateway.network.thegraph.com/network`      |
| `INDEXER_AGENT_DAI_CONTRACT`              | `--dai-contract`              | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` (USDC) |

#### Indexer Service

| Environment Variable                        | CLI Argument                  | Value                                          |
| ------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| `INDEXER_SERVICE_ETHEREUM`                  | `--ethereum`                  | An Ethereum mainnet node/provider              |
| `INDEXER_SERVICE_ETHEREUM_NETWORK`          | `--ethereum-network`          | `1`                                            |
| `INDEXER_SERVICE_INDEXER_ADDRESS`           | `--indexer-address`           | Ethereum address of mainnet indexer            |
| `INDEXER_SERVICE_MNEMONIC`                  | `--mnemonic`                  | Ethereum mnemonic for mainnet operator         |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT` | `--network-subgraph-endpoint` | `https://gateway.network.thegraph.com/network` |

#### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `mainnet:...`                       |
| `ipfs`               | `--ipfs`         | `https://ipfs.network.thegraph.com` |

## Testnet (https://testnet.thegraph.com/, Rinkeby)

### Registration / Funding (GRT)

In order to register for the testnet and have testnet GRT distributed to you,
please fill out the [testnet registration form](https://airtable.com/shrL1trS84Jf0aawP).

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

| Environment Variable                      | CLI Argument                  | Value                                                                               |
| ----------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `INDEXER_AGENT_ETHEREUM`                  | `--ethereum`                  | An Ethereum rinkeby node/provider                                                   |
| `INDEXER_AGENT_ETHEREUM_NETWORK`          | `--ethereum-network`          | `4` (rinkeby)                                                                       |
| `INDEXER_AGENT_INDEXER_ADDRESS`           | `--indexer-address`           | Ethereum address of testnet indexer                                                 |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`   | `--indexer-geo-coordinates`   | Geo coordinates of testnet indexer infrastructure                                   |
| `INDEXER_AGENT_MNEMONIC`                  | `--mnemonic`                  | Ethereum mnemonic for testnet operator                                              |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT` | `--network-subgraph-endpoint` | `https://gateway.testnet.thegraph.com/network`                                      |
| `INDEXER_AGENT_DAI_CONTRACT`              | `--dai-contract`              | `0x9e7e607afd22906f7da6f1ec8f432d6f244278be` (GDAI)                                 |
| `INDEXER_AGENT_VECTOR_NODE`               | `--vector-node`               | Internal URL of the Vector node in the indexer's infrastructure                     |
| `INDEXER_AGENT_VECTOR_EVENT_SERVER`       | `--vector-event-server`       | Internal URL of indexer-agent's Vector event server in the indexer's infrastructure |
| `INDEXER_AGENT_VECTOR_EVENT_SERVER_PORT`  | `--vector-event-server-port`  | Default: `8001` (note: don't expose this to the public)                             |
| `INDEXER_AGENT_VECTOR_ROUTER`             | `--vector-router`             | `vector8BSZxfkr62As6KZX2so4yXuex5XcpPXQ2tYZrBqpub94dAobu7`                          |

#### Indexer Service

| Environment Variable                        | CLI Argument                  | Value                                                           |
| ------------------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `INDEXER_SERVICE_ETHEREUM`                  | `--ethereum`                  | An Ethereum rinkeby node/provider                               |
| `INDEXER_SERVICE_ETHEREUM_NETWORK`          | `--ethereum-network`          | `4` (rinkeby)                                                   |
| `INDEXER_SERVICE_INDEXER_ADDRESS`           | `--indexer-address`           | Ethereum address of testnet indexer                             |
| `INDEXER_SERVICE_MNEMONIC`                  | `--mnemonic`                  | Ethereum mnemonic for testnet operator                          |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT` | `--network-subgraph-endpoint` | `https://gateway.testnet.thegraph.com/network`                  |
| `INDEXER_SERVICE_VECTOR_NODE`               | `--vector-node`               | Internal URL of the Vector node in the indexer's infrastructure |
| `INDEXER_SERVICE_VECTOR_ROUTER`             | `--vector-router`             | `vector8BSZxfkr62As6KZX2so4yXuex5XcpPXQ2tYZrBqpub94dAobu7`      |

#### Graph Node

| Environment Variable | CLI Argument     | Value                               |
| -------------------- | ---------------- | ----------------------------------- |
| `ethereum`           | `--ethereum-rpc` | `mainnet:...`                       |
| `ipfs`               | `--ipfs`         | `https://ipfs.testnet.thegraph.com` |

#### Vector Node

| Environment Variable | Value                                                                |
| -------------------- | -------------------------------------------------------------------- |
| `VECTOR_PROD`        | `true`                                                               |
| `VECTOR_MNEMONIC`    | e.g. same as `INDEXER_SERVICE_MNEMONIC` and `INDEXER_AGENT_MNEMONIC` |
| `VECTOR_PG_HOST`     | e.g. same as `INDEXER_SERVICE_POSTGRES_HOST`                         |
| `VECTOR_PG_PORT`     | e.g. `5432`                                                          |
| `VECTOR_PG_USERNAME` | e.g. same as `INDEXER_SERVICE_POSTGRES_USERNAME`                     |
| `VECTOR_PG_PASSWORD` | e.g. same as `INDEXER_SERVICE_POSTGRES_PASSWORD`                     |
| `VECTOR_PG_DATABASE` | e.g. `vector`                                                        |
| `VECTOR_CONFIG`      | see below                                                            |

The `VECTOR_CONFIG` variable should be a JSON string that contains the following:

```json
{
  "adminToken": "<secret token of your choice, keep to yourself>",
  "chainProviders": {
    "4": "<some rinkeby Ethereum node/provider"
  },
  "nodeUrl": "<internal URL of the Vector node in your infrastructure>",
  "logLevel": "info",
  "natsUrl": "nats://nats1.connext.provide.network:4222,nats://nats2.connext.provide.network:4222,nats://nats3.connext.provide.network:4222",
  "authUrl": "https://messaging.connext.network",
  "messagingUrl": "https://messaging.connext.network",
  "production": true,
  "baseGasSubsidyPercentage": 0,
  "allowedSwaps": [],
  "skipCheckIn": true,
  "mnemonic": "<the same as INDEXER_AGENT_MNEMONIC>"
}
```
