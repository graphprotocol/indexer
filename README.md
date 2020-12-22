# Graph Protocol Indexer Components

![CI](https://github.com/graphprotocol/indexer/workflows/CI/badge.svg)
[![Docker Image: Indexer Service](https://github.com/graphprotocol/indexer/workflows/Indexer%20Service%20Image/badge.svg)](https://hub.docker.com/r/graphprotocol/indexer-service)
[![Docker Image: Indexer Agent](https://github.com/graphprotocol/indexer/workflows/Indexer%20Agent%20Image/badge.svg)](https://hub.docker.com/r/graphprotocol/indexer-agent)

This repository is managed using [Lerna](https://lerna.js.org/) and [Yarn
workspaces](https://classic.yarnpkg.com/en/docs/workspaces/).

[chan](https://github.com/geut/chan/tree/master/packages/chan) is (or will be)
used to maintain the following changelogs:

- [indexer-service](packages/indexer-service/CHANGELOG.md)
- [indexer-agent](packages/indexer-agent/CHANGELOG.md)
- [indexer-cli](packages/indexer-cli/CHANGELOG.md)
- [indexer-common](packages/indexer-common/CHANGELOG.md)

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
  --network-subgraph-endpoint  Endpoint to query the network subgraph from
                                                             [string] [required]

State Channels
  --wallet-worker-threads       Number of worker threads for the server wallet
                                                           [number] [default: 8]
  --wallet-skip-evm-validation  Whether to skip EVM-based validation of state
                                channel transitions    [boolean] [default: true]

Options:
  --version                Show version number                         [boolean]
  --help                   Show help                                   [boolean]
  --free-query-auth-token  Auth token that clients can use to query for free
                                                                         [array]
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

Options:
  --version       Show version number                                  [boolean]
  --help          Show help                                            [boolean]
  --dai-contract  Address of the DAI or USDC contract to use for the
                  --inject-dai conversion rate
                [string] [default: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]
```

### Indexer CLI

Since indexer CLI is a plugin for `@graphprotocol/graph-cli`, it is invoked
simply by running `graph indexer`.

```sh
$ graph --help

  ...
  indexer status                 Check the status of an indexer
  indexer rules stop (never)     Never index a deployment (and stop indexing it if necessary)
  indexer rules start (always)   Always index a deployment (and start indexing it if necessary)
  indexer rules set              Set one or more indexing rules
  indexer rules maybe            Index a deployment based on rules
  indexer rules get              Get one or more indexing rules
  indexer rules delete           Remove one or many indexing rules
  indexer rules clear (reset)    Clear one or more indexing rules
  indexer rules                  Configure indexing rules
  indexer cost set variables     Update cost model variables
  indexer cost set model         Update a cost model
  indexer cost get               Get cost models and/or variables for one or all subgraphs
  indexer cost                   Manage costing for subgraphs
  indexer connect                Connect to indexer management API
  indexer                        Manage indexer configuration
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
docker pull graphprotocol/indexer-service:latest
docker pull graphprotocol/indexer-agent:latest
```

or built locally with

```sh
# Indexer service
docker build \
  --build-arg NPM_TOKEN=<npm-token> \
  -f Dockerfile.indexer-service \
  -t indexer-service:latest \
  .

# Indexer agent
docker build \
  --build-arg NPM_TOKEN=<npm-token> \
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

   ````sh
   docker run -p 18000:8000 -it indexer-agent:latest ...
   ```

   This starts the indexer agent and serves the so-called indexer management API
   on the host at port 18000.

   ````

## Terraform & Kubernetes

The [terraform/](./terraform/) and [k8s/](./k8s) directories provide a
complete example setup for running an indexer on the Google Cloud Kubernetes
Engine (GKE). This setup was also used as the reference setup in the Mission
Control testnet and can be a good starting point for those looking to run the
indexer in a virtualized environment.

Check out the [terraform README](./terraform/README.md) for details on how to
get started.

## Releasing

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

Copyright &copy; 2020 The Graph Foundation

Licensed under the [MIT license](LICENSE).
