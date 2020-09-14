# Graph Protocol Indexer Components (Private)

![CI](https://github.com/graphprotocol/indexer/workflows/CI/badge.svg)
[![Docker Image: Indexer Service](https://github.com/graphprotocol/indexer/workflows/Indexer%20Service%20Image/badge.svg)](https://hub.docker.com/r/graphprotocol/indexer-service)
[![Docker Image: Indexer Agent](https://github.com/graphprotocol/indexer/workflows/Indexer%20Agent%20Image/badge.svg)](https://hub.docker.com/r/graphprotocol/indexer-agent)

This repository is managed using [Lerna](https://lerna.js.org/) and [Yarn
workspaces](https://classic.yarnpkg.com/en/docs/workspaces/).

[Chan](https://github.com/geut/chan/tree/master/packages/chan) is (or will be)
used to maintain the following changelogs:

- [indexer-service](packages/indexer-service/CHANGELOG.md)
- [indexer-agent](packages/indexer-agent/CHANGELOG.md)
- [indexer-cli](packages/indexer-cli/CHANGELOG.md)
- [indexer-common](packages/indexer-common/CHANGELOG.md)

## Running from NPM packages

The indexer service, agent and CLI can be installed as NPM packages, using

```sh
npm install -g @graphprotocol/indexer-service --registry https://testnet.thegraph.com/npm-registry/
npm install -g @graphprotocol/indexer-agent   --registry https://testnet.thegraph.com/npm-registry/
npm install -g @graphprotocol/indexer-cli     --registry https://testnet.thegraph.com/npm-registry/
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

### Usage

#### Indexer service

```sh
$ graph-indexer-service start --help

Start the service

Ethereum
  --ethereum  Ethereum node or provider URL                  [string] [required]
  --mnemonic  Ethereum wallet mnemonic                       [string] [required]

Indexer Infrastructure
  --port                        Port to serve from      [number] [default: 7600]
  --graph-node-query-endpoint   Graph Node endpoint to forward queries to
                                                             [string] [required]
  --graph-node-status-endpoint  Graph Node endpoint for indexing statuses etc.
                                                             [string] [required]

Network Subgraph
  --network-subgraph-deployment  Network subgraph deployment            [string]
  --network-subgraph-endpoint    Endpoint to query the network subgraph from
                                                                        [string]

Options:
  --version                Show version number                         [boolean]
  --help                   Show help                                   [boolean]
  --free-query-auth-token  Auth token that clients can use to query for free
                                                                         [array]
```

#### Indexer agent

```sh
$ graph-indexer-agent start --help

Start the agent

Ethereum
  --ethereum  Ethereum node or provider URL                  [string] [required]
  --mnemonic  Mnemonic for the wallet                        [string] [required]

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
                                                              [array] [required]
  --indexer-management-port     Port to serve the indexer management API at
                                                        [number] [default: 8000]

Network Subgraph
  --network-subgraph-deployment  Network subgraph deployment            [string]
  --network-subgraph-endpoint    Endpoint to query the network subgraph from
                                                                        [string]

Protocol
  --default-allocation-amount  Default amount of GRT to allocate to a subgraph
                               deployment             [string] [default: "0.01"]

Postgres
  --postgres-host      Postgres host                         [string] [required]
  --postgres-port      Postgres port                    [number] [default: 5432]
  --postgres-username  Postgres username          [string] [default: "postgres"]
  --postgres-password  Postgres password                  [string] [default: ""]
  --postgres-database  Postgres database name                [string] [required]

Options:
  --version  Show version number                                       [boolean]
  --help     Show help                                                 [boolean]
```

## Running from source

Run the following at the root of this repository to install dependencies and build the packages:

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
   docker run \
     -p 7600:7600 \
     -it indexer-service:latest \
     ...
   ```

   After this, the indexer service should be up and running at
   http://localhost:7600/.

2. Indexer Agent

   ````sh
   docker run \
     -p 18000:8000 \
     -it indexer-agent:latest \
     ...
   ```

   This starts the indexer agent and serves the so-called indexer management API
   on the host at port 18000.

   ````

## Releasing

Creating a new release involves the following steps:

1. Update all changelogs:

   ```sh
   pushd packages/indexer-service
   chan added ...
   chan fixed ...
   chan changed ...
   chan release <new-version>
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

2. Commit these changelogs:

   ```sh
   git add packages/**/CHANGELOG.md
   git commit -m "Update changelogs ahead of release"
   ```

3. Publish a new release:

   ```sh
   lerna publish
   ```

   When it asks for the version to release, select the same one that was used
   when updating the changelogs.

# Copyright

Copyright &copy; 2020 Graph Protocol, Inc.
