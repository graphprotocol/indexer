# Graph Protocol Indexer Components

![CI](https://github.com/graphprotocol/indexer/workflows/CI/badge.svg)
[![Docker Image: Indexer Service](https://github.com/graphprotocol/indexer/workflows/Indexer%20Service%20Image/badge.svg)](https://github.com/orgs/graphprotocol/packages/container/package/indexer-service)
[![Docker Image: Indexer Agent](https://github.com/graphprotocol/indexer/workflows/Indexer%20Agent%20Image/badge.svg)](https://github.com/orgs/graphprotocol/packages/container/package/indexer-agent)

**NOTE: THIS PROJECT IS BETA SOFTWARE.**

## The Graph Network vs. Testnet

For configuration details for The Graph Network and the testnet, see the
[Mainnet and Testnet Configuration docs](./docs/networks.md).

An overview of [Scalar](./docs/scalar.md), a microtransaction framework for
query fees, can be found [here](./docs/scalar.md).

## Running from NPM packages

The indexer service, agent and CLI can be installed as NPM packages, using

```sh
npm install -g @graphprotocol/indexer-service
npm install -g @graphprotocol/indexer-agent

# Indexer CLI is a plugin for Graph CLI, so both need to be installed:
npm install -g @graphprotocol/graph-cli
npm install -g @graphprotocol/indexer-cli
```

After that, they can be run with the following commands:

```sh
# Indexer service
graph-indexer-service start ...

# Indexer agent
graph-indexer-agent start ...

# Indexer CLI
graph indexer ...
```

## Usage

### Indexer service

```sh
$ graph-indexer-service start --help

Start the service

Ethereum
  --ethereum                   Ethereum node or provider URL [string] [required]
  --ethereum-network           Ethereum network    [string] [default: "mainnet"]
  --ethereum-polling-interval  Polling interval for the Ethereum provider (ms)
                                                        [number] [default: 4000]
  --mnemonic                   Mnemonic for the operator wallet
                                                             [string] [required]
  --indexer-address            Ethereum address of the indexer
                                                             [string] [required]

Indexer Infrastructure
  --port                        Port to serve queries at[number] [default: 7600]
  --metrics-port                Port to serve Prometheus metrics at
                                                        [number] [default: 7300]
  --graph-node-query-endpoint   Graph Node endpoint to forward queries to
                                                             [string] [required]
  --graph-node-status-endpoint  Graph Node endpoint for indexing statuses etc.
                                                             [string] [required]
  --log-level                   Log level            [string] [default: "debug"]

Postgres
  --postgres-host      Postgres host                         [string] [required]
  --postgres-port      Postgres port                    [number] [default: 5432]
  --postgres-username  Postgres username          [string] [default: "postgres"]
  --postgres-password  Postgres password                  [string] [default: ""]
  --postgres-database  Postgres database name                [string] [required]

Network Subgraph
  --network-subgraph-endpoint    Endpoint to query the network subgraph from
                                                             [string] [required]
  --allocation-syncing-interval  Interval (in ms) for syncing indexer
                                 allocations from the network
                                                      [number] [default: 120000]

Query Fees
  --vector-node                 URL of a vector node                    [string]
  --vector-router               Public identifier of the vector router  [string]
  --vector-transfer-definition  Address of the Graph transfer definition
                                contract              [string] [default: "auto"]

Options:
  --version                Show version number                         [boolean]
  --help                   Show help                                   [boolean]
  --gcloud-profiling       Whether to enable Google Cloud profiling
                                                      [boolean] [default: false]
  --free-query-auth-token  Auth token that clients can use to query for free
                                                                         [array]
  --client-signer-address  Address that signs query fee receipts from a known
                           client                                       [string]
```

### Indexer agent

```sh
$ graph-indexer-agent start --help

Start the agent

Ethereum
  --ethereum                   Ethereum node or provider URL [string] [required]
  --ethereum-network           Ethereum network    [string] [default: "mainnet"]
  --ethereum-polling-interval  Polling interval for the Ethereum provider (ms)
                                                        [number] [default: 4000]
  --gas-increase-timeout       Time (in seconds) after which transactions will
                               be resubmitted with a higher gas price
                                                         [number] [default: 240]
  --gas-increase-factor        Factor by which gas prices are increased when
                               resubmitting transactions [number] [default: 1.2]
  --gas-price-max              The maximum gas price (gwei) to use for
                               transactions       [number] [default: 2000000000]
  --transaction-attempts       The maximum number of transaction attempts
                                                           [number] [default: 5]
  --mnemonic                   Mnemonic for the operator wallet
                                                             [string] [required]
  --indexer-address            Ethereum address of the indexer
                                                             [string] [required]

Indexer Infrastructure
  --graph-node-query-endpoint   Graph Node endpoint for querying subgraphs
                                                             [string] [required]
  --graph-node-status-endpoint  Graph Node endpoint for indexing statuses etc.
                                                             [string] [required]
  --graph-node-admin-endpoint   Graph Node endpoint for applying and updating
                                subgraph deployments         [string] [required]
  --public-indexer-url          Indexer endpoint for receiving requests from the
                                network                      [string] [required]
  --indexer-geo-coordinates     Coordinates describing the Indexer's location
                                using latitude and longitude
                                   [array] [default: ["31.780715","-41.179504"]]
  --index-node-ids              Node IDs of Graph nodes to use for indexing
                                (separated by commas)         [array] [required]
  --indexer-management-port     Port to serve the indexer management API at
                                                        [number] [default: 8000]
  --metrics-port                Port to serve Prometheus metrics at     [number]
  --restake-rewards             Restake claimed indexer rewards, if set to
                                'false' rewards will be returned to the wallet
                                                       [boolean] [default: true]
  --allocation-claim-threshold  Minimum query fees collected (GRT) on an
                                allocation for it to be claimed
                                                           [number] [default: 0]
  --log-level                   Log level            [string] [default: "debug"]

Network Subgraph
  --network-subgraph-deployment  Network subgraph deployment            [string]
  --network-subgraph-endpoint    Endpoint to query the network subgraph from
                                                                        [string]

Protocol
  --default-allocation-amount  Default amount of GRT to allocate to a subgraph
                               deployment             [string] [default: "0.01"]
  --register                   Whether to register the indexer on chain
                                                       [boolean] [default: true]

Cost Models
  --inject-dai  Inject the GRT to DAI/USDC conversion rate into cost model
                variables                              [boolean] [default: true]

Postgres
  --postgres-host      Postgres host                         [string] [required]
  --postgres-port      Postgres port                    [number] [default: 5432]
  --postgres-username  Postgres username          [string] [default: "postgres"]
  --postgres-password  Postgres password                  [string] [default: ""]
  --postgres-database  Postgres database name                [string] [required]

Disputes
  --poi-disputable-epochs   The number of epochs in the past to look for
                            potential POI disputes         [number] [default: 1]
  --poi-dispute-monitoring  Monitor the network for potential POI disputes
                                                      [boolean] [default: false]

Query Fees
  --vector-node                   URL of a vector node                  [string]
  --vector-router                 Public identifier of the vector router[string]
  --vector-transfer-definition    Address of the Graph transfer definition
                                  contract            [string] [default: "auto"]
  --vector-event-server           External URL of the vector event server of the
                                  agent                                 [string]
  --vector-event-server-port      Port to serve the vector event server at
                                                        [number] [default: 8001]
  --allocation-exchange-contract  Address of the contract to submit query fee
                                  vouchers to         [string] [default: "auto"]
  --collect-receipts-endpoint     Client endpoint for collecting receipts
                                                                        [string]

Options:
  --version             Show version number                            [boolean]
  --help                Show help                                      [boolean]
  --dai-contract        Address of the DAI or USDC contract to use for the
                        --inject-dai conversion rate
                [string] [default: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]
  --offchain-subgraphs  Subgraphs to index that are not on chain
                        (comma-separated)                  [array] [default: []]
```

### Indexer CLI

Since indexer CLI is a plugin for `@graphprotocol/graph-cli`, it is invoked
simply by running `graph indexer`.

```sh
$ graph --help

  ...
  indexer status                      Check the status of an indexer
  indexer rules                       Configure indexing rules
  indexer rules stop (never)          Never index a deployment (and stop indexing it if necessary)
  indexer rules start (always)        Always index a deployment (and start indexing it if necessary)
  indexer rules prepare (offchain)    Offchain index a deployment (good practice to prepare indexing)
  indexer rules set                   Set one or more indexing rules
  indexer rules maybe                 Index a deployment based on rules
  indexer rules get                   Get one or more indexing rules
  indexer rules delete                Remove one or many indexing rules
  indexer rules clear (reset)         Clear one or more indexing rules
  indexer disputes                    POI monitoring
  indexer disputes get                Cross-check POIs submitted in the network
  indexer cost                        Manage costing for subgraphs
  indexer cost set variables          Update cost model variables
  indexer cost set model              Update a cost model
  indexer cost get                    Get cost models and/or variables for one or all subgraphs
  indexer connect                     Connect to indexer management API
  indexer                             Manage indexer configuration
```

## Running from source

Run the following at the root of this repository to install dependencies and
build the packages:

```sh
yarn
```

After this, the indexer service and agent can be run with:

```sh
# Indexer service
cd packages/indexer-service
./bin/graph-indexer-service start ...

# Indexer agent
cd packages/indexer-service
./bin/graph-indexer-service start ...
```

## Docker images

The easiest way to run the indexer service agent is by using Docker. Docker
images can either be pulled via

```sh
docker pull ghcr.io/graphprotocol/indexer-service:latest
docker pull ghcr.io/graphprotocol/indexer-agent:latest
```

or built locally with

```sh
# Indexer service
docker build \
  -f Dockerfile.indexer-service \
  -t indexer-service:latest \
  .

# Indexer agent
docker build \
  -f Dockerfile.indexer-agent \
  -t indexer-agent:latest \
  .
```

After this, the indexer agent and service can be run as follows:

1. Indexer service:

   ```sh
   docker run -p 7600:7600 -it indexer-service:latest ...
   ```

   After this, the indexer service should be up and running at
   http://localhost:7600/.

2. Indexer Agent

   ```sh
   docker run -p 18000:8000 -it indexer-agent:latest ...
   ```

   This starts the indexer agent and serves the so-called indexer management API
   on the host at port 18000.

## Terraform & Kubernetes

The [terraform/](./terraform/) and [k8s/](./k8s) directories provide a
complete example setup for running an indexer on the Google Cloud Kubernetes
Engine (GKE). This setup was also used as the reference setup in the Mission
Control testnet and can be a good starting point for those looking to run the
indexer in a virtualized environment.

Check out the [terraform README](./terraform/README.md) for details on how to
get started.

## Releasing

This repository is managed using [Lerna](https://lerna.js.org/) and [Yarn
workspaces](https://classic.yarnpkg.com/en/docs/workspaces/).

[chan](https://github.com/geut/chan/tree/master/packages/chan) is
used to maintain the following changelogs:

- [indexer-service](packages/indexer-service/CHANGELOG.md)
- [indexer-agent](packages/indexer-agent/CHANGELOG.md)
- [indexer-cli](packages/indexer-cli/CHANGELOG.md)
- [indexer-common](packages/indexer-common/CHANGELOG.md)

Creating a new release involves the following steps:

1. Update all changelogs:

   ```sh
   pushd packages/indexer-service
   chan added ...
   chan fixed ...
   chan changed ...
   popd

   pushd packages/indexer-agent
   ...
   popd

   pushd packages/indexer-cli
   ...
   popd

   pushd packages/indexer-common
   ...
   popd

   ```

2. Publish the release. This includes committing the changelogs, tagging the
   new version and publishing packages on npmjs.com.

   ```sh
   yarn release <version>
   ```

# Copyright

Copyright &copy; 2020-2021 The Graph Foundation

Licensed under the [MIT license](LICENSE).
