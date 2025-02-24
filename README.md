# Graph Protocol Indexer Components

![CI](https://github.com/graphprotocol/indexer/workflows/CI/badge.svg)
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
npm install -g @graphprotocol/indexer-agent

# Indexer CLI is a plugin for Graph CLI, so both need to be installed:
npm install -g @graphprotocol/graph-cli
npm install -g @graphprotocol/indexer-cli
```

After that, they can be run with the following commands:

```sh
# Indexer agent
graph-indexer-agent start ...

# Indexer CLI
graph indexer ...
```

## Usage

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
                               transactions [deprecated] [number] [default: 100]
  --base-fee-per-gas-max       The maximum base fee per gas (gwei) to use for
                               transactions, for legacy transactions this will
                               be treated as the max gas price          [number]
  --transaction-attempts       The maximum number of transaction attempts (Use 0
                               for unlimited)              [number] [default: 0]
  --mnemonic                   Mnemonic for the operator wallet
                                                             [string] [required]
  --indexer-address            Ethereum address of the indexer
                                                             [string] [required]

Indexer Infrastructure
  --graph-node-query-endpoint           Graph Node endpoint for querying
                                        subgraphs            [string] [required]
  --graph-node-status-endpoint          Graph Node endpoint for indexing
                                        statuses etc.        [string] [required]
  --graph-node-admin-endpoint           Graph Node endpoint for applying and
                                        updating subgraph deployments
                                                             [string] [required]
  --public-indexer-url                  Indexer endpoint for receiving requests
                                        from the network     [string] [required]
  --indexer-geo-coordinates             Coordinates describing the Indexer's
                                        location using latitude and longitude
                                   [array] [default: ["31.780715","-41.179504"]]
  --index-node-ids                      Node IDs of Graph nodes to use for
                                        indexing (separated by commas)
                                                              [array] [required]
  --indexer-management-port             Port to serve the indexer management API
                                        at              [number] [default: 8000]
  --metrics-port                        Port to serve Prometheus metrics at
                                                                        [number]
  --syncing-port                        Port to serve the network subgraph and
                                        other syncing data for indexer service
                                        at              [number] [default: 8002]
  --restake-rewards                     Restake claimed indexer rewards, if set
                                        to 'false' rewards will be returned to
                                        the wallet     [boolean] [default: true]
  --rebate-claim-threshold              Minimum value of rebate for a single
                                        allocation (in GRT) in order for it to
                                        be included in a batch rebate claim
                                        on-chain       [string] [default: "1"]
  --rebate-claim-batch-threshold        Minimum total value of all rebates in an
                                        batch (in GRT) before the batch is
                                        claimed on-chain
                                                      [string] [default: "5"]
  --rebate-claim-max-batch-size         Maximum number of rebates inside a
                                        batch. Upper bound is constrained by
                                        available system memory, and by the
                                        block gas limit  [number] [default: 100]
  --voucher-redemption-threshold        Minimum value of rebate for a single
                                        allocation (in GRT) in order for it to
                                        be included in a batch rebate claim
                                        on-chain       [string] [default: "1"]
  --voucher-redemption-batch-threshold  Minimum total value of all rebates in an
                                        batch (in GRT) before the batch is
                                        claimed on-chain
                                                      [string] [default: "5"]
  --voucher-redemption-max-batch-size   Maximum number of rebates inside a
                                        batch. Upper bound is constrained by
                                        available system memory, and by the
                                        block gas limit  [number] [default: 100]
  --log-level                           Log level    [string] [default: "debug"]
  --allocation-management               Indexer agent allocation management
                                        automation mode (auto|manual|oversight)
                                                      [string] [default: "auto"]
  --auto-allocation-min-batch-size                 Minimum number of allocation 
                                        transactions inside a batch for AUTO 
                                        management mode    [number] [default: 1]

Network Subgraph
  --network-subgraph-deployment   Network subgraph deployment           [string]
  --network-subgraph-endpoint     Endpoint to query the network subgraph from
                                                                        [string]
  --allocate-on-network-subgraph  Whether to allocate to the network subgraph
                                                      [boolean] [default: false]

Protocol
  --default-allocation-amount  Default amount of GRT to allocate to a subgraph
                               deployment             [string] [default: "0.01"]
  --register                   Whether to register the indexer on chain
                                                       [boolean] [default: true]
  --epoch-subgraph-endpoint    Endpoint to query epoch start blocks from
                                                             [string] [required]

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
  --collect-receipts-endpoint     Client endpoint for collecting receipts
                                                                        [string]

Options:
  --version             Show version number                            [boolean]
  --help                Show help                                      [boolean]
  --offchain-subgraphs  Subgraphs to index that are not on chain
                        (comma-separated)                  [array] [default: []]
```

### Indexer CLI

Since indexer CLI is a plugin for `@graphprotocol/graph-cli`, once installed it is invoked
simply by running `graph indexer`.

```sh
$ graph indexer --help
Manage indexer configuration

  indexer status                     Check the status of an indexer                                   
  indexer rules stop (never)         Never index a deployment (and stop indexing it if necessary)     
  indexer rules start (always)       Always index a deployment (and start indexing it if necessary)   
  indexer rules set                  Set one or more indexing rules                                   
  indexer rules prepare (offchain)   Offchain index a deployment (and start indexing it if necessary) 
  indexer rules maybe                Index a deployment based on rules                                
  indexer rules get                  Get one or more indexing rules                                   
  indexer rules delete               Remove one or many indexing rules                                
  indexer rules clear (reset)        Clear one or more indexing rules                                 
  indexer rules                      Configure indexing rules                                         
  indexer disputes get               Cross-check POIs submitted in the network                        
  indexer disputes                   Configure allocation POI monitoring                              
  indexer cost set model             Update a cost model                                              
  indexer cost get                   Get cost models for one or all subgraphs        
  indexer cost                       Manage costing for subgraphs                                     
  indexer connect                    Connect to indexer management API                                
  indexer allocations reallocate     Reallocate to subgraph deployment                                
  indexer allocations get            List one or more allocations                                     
  indexer allocations create         Create an allocation                                             
  indexer allocations close          Close an allocation                                              
  indexer allocations                Manage indexer allocations                                       
  indexer actions queue              Queue an action item                                             
  indexer actions get                List one or more actions                                         
  indexer actions execute            Execute approved items in the action queue                       
  indexer actions cancel             Cancel an item in the queue                                      
  indexer actions approve            Approve an action item                                           
  indexer actions                    Manage indexer actions                                           
  indexer                            Manage indexer configuration 
```

## Running from source

Run the following at the root of this repository to install dependencies and
build the packages:

```sh
yarn
```

After this, the agent can be run with:

```sh
# Indexer agent
cd packages/indexer-agent
./bin/graph-indexer-agent start ...
```

## Docker images

The easiest way to run the indexer agent is by using Docker. Docker
images can either be pulled via

```sh
docker pull ghcr.io/graphprotocol/indexer-agent:latest
```

or built locally with

```sh
# Indexer agent
docker build \
  -f Dockerfile.indexer-agent \
  -t indexer-agent:latest \
  .
```

After this, the indexer agent can be run as follows:

1. Indexer Agent

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

- [indexer-agent](packages/indexer-agent/CHANGELOG.md)
- [indexer-cli](packages/indexer-cli/CHANGELOG.md)
- [indexer-common](packages/indexer-common/CHANGELOG.md)

Creating a new release involves the following steps:

1. Update all changelogs:

   ```sh
   pushd packages/indexer-agent
   chan added ...
   chan fixed ...
   chan changed ...
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

## Running tests locally

To run the tests locally, you'll need:
1. Docker installed and running
2. Node.js and Yarn
3. An Arbitrum Sepolia testnet RPC provider (e.g., Infura, Alchemy)
4. An API key from The Graph Studio for querying subgraphs

### Setup

1. Create a `.env` file in the root directory with your credentials. You can copy the example file as a template:
```sh
cp .env.example .env
```

Then edit `.env` with your credentials:
```plaintext
# Your Arbitrum Sepolia testnet RPC endpoint
INDEXER_TEST_JRPC_PROVIDER_URL=https://sepolia.infura.io/v3/your-project-id

# Your API key from The Graph Studio (https://thegraph.com/studio/)
INDEXER_TEST_API_KEY=your-graph-api-key-here
```

2. Run the tests:
```sh
bash scripts/run-tests.sh
```

The script will:
- Start a PostgreSQL container with the required test configuration
- Load your credentials from the `.env` file
- Run the test suite
- Clean up the PostgreSQL container when done

# Copyright

Copyright &copy; 2020-2021 The Graph Foundation

Licensed under the [MIT license](LICENSE).
