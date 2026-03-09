# Graph Protocol Indexer Components

![CI](https://github.com/graphprotocol/indexer/workflows/CI/badge.svg)
[![Docker Image: Indexer Agent](https://github.com/graphprotocol/indexer/workflows/Indexer%20Agent%20Image/badge.svg)](https://github.com/orgs/graphprotocol/packages/container/package/indexer-agent)

This repository contains the indexer agent and CLI for participating in The Graph Network as an indexer.

## Components

| Package | Description |
|---------|-------------|
| **[indexer-agent](./packages/indexer-agent)** | Autonomous agent that manages allocations, collects query fees, and submits proofs of indexing |
| **[indexer-cli](./packages/indexer-cli)** | CLI for managing indexer operations (`graph indexer ...`) |
| **[indexer-common](./packages/indexer-common)** | Shared library used by agent and CLI |

## Documentation

| Topic | Description |
|-------|-------------|
| [Network Configuration](./docs/networks.md) | Mainnet and testnet setup |
| [Operation Modes](./docs/operation-modes.md) | AUTO, OVERSIGHT, and MANUAL modes |
| [Allocation Management](./docs/allocation-management/) | How to manage allocations (rules, action queue, direct commands) |
| [Provision Management](./docs/provision-management.md) | Managing stake provisions (Horizon) |

## Quick Start

### Installation

```sh
npm install -g @graphprotocol/indexer-agent

# CLI is a plugin for graph-cli
npm install -g @graphprotocol/graph-cli
npm install -g @graphprotocol/indexer-cli
```

### Running

```sh
# Start the agent
graph-indexer-agent start \
  --network-provider <ethereum-rpc> \
  --graph-node-query-endpoint <graph-node-url>/subgraphs \
  --graph-node-status-endpoint <graph-node-url>/graphql \
  --graph-node-admin-endpoint <graph-node-url>/deploy \
  --mnemonic <operator-mnemonic> \
  --indexer-address <indexer-address> \
  --postgres-host <postgres-host> \
  --postgres-database <database-name> \
  --network-subgraph-endpoint <network-subgraph-url> \
  --epoch-subgraph-endpoint <epoch-subgraph-url> \
  --gateway-endpoint <gateway-url> \
  --public-indexer-url <public-url>

# Use the CLI
graph indexer rules set global decisionBasis always allocationAmount 1000
graph indexer allocations get --network arbitrum-one
graph indexer actions get all
```

### Docker

```sh
docker pull ghcr.io/graphprotocol/indexer-agent:latest
docker run -p 8000:8000 indexer-agent:latest start ...
```

## Development

### Building from Source

```sh
yarn              # Install dependencies
yarn bootstrap    # Bootstrap packages
yarn compile      # Compile TypeScript
```

### Running Tests

```sh
# Create .env with test credentials (see .env.example)
bash scripts/run-tests.sh
```

### Project Structure

```
packages/
├── indexer-agent/     # Main agent
├── indexer-cli/       # CLI tool
└── indexer-common/    # Shared library
docs/                  # Documentation
k8s/                   # Kubernetes configs
terraform/             # GKE deployment
```

## CLI Reference

<details>
<summary>Indexer Agent options</summary>

```
graph-indexer-agent start --help

Indexer Infrastructure
  --indexer-management-port         Port for management API [default: 8000]
  --metrics-port                    Port for Prometheus metrics [default: 7300]
  --allocation-management           Mode: auto|manual|oversight [default: auto]
  --polling-interval                Polling interval in ms [default: 120000]

Ethereum
  --network-provider                Ethereum RPC URL [required]
  --mnemonic                        Operator wallet mnemonic [required]
  --indexer-address                 Indexer address [required]

Postgres
  --postgres-host                   Database host [required]
  --postgres-database               Database name [required]

Network Subgraph
  --network-subgraph-endpoint       Network subgraph URL
  --epoch-subgraph-endpoint         Epoch subgraph URL [required]

See --help for all options.
```

</details>

<details>
<summary>Indexer CLI commands</summary>

```
graph indexer --help

indexer status                     Check indexer status
indexer connect                    Connect to management API

indexer rules                      Manage indexing rules
indexer rules set                  Set indexing rules
indexer rules get                  Get indexing rules
indexer rules start                Always index a deployment
indexer rules stop                 Never index a deployment

indexer allocations                Manage allocations
indexer allocations get            List allocations
indexer allocations create         Create allocation
indexer allocations close          Close allocation
indexer allocations reallocate     Reallocate
indexer allocations present-poi    Present POI (Horizon)
indexer allocations resize         Resize allocation (Horizon)

indexer actions                    Manage action queue
indexer actions get                List actions
indexer actions queue              Queue an action
indexer actions approve            Approve actions
indexer actions execute            Execute approved actions

indexer provision                  Manage provisions (Horizon)
indexer cost                       Manage cost models
indexer disputes                   Monitor POI disputes
```

</details>

## Infrastructure Deployment

For production deployments, see:
- [Terraform setup for GKE](./terraform/README.md)
- [Kubernetes configurations](./k8s/)

## Releasing

This repository uses [Lerna](https://lerna.js.org/) with Yarn workspaces.

```sh
# Update changelogs with chan
pushd packages/indexer-agent && chan added "..." && popd

# Publish release
yarn release <version>
```

## License

Copyright &copy; 2020-2026 The Graph Foundation

Licensed under the [MIT license](LICENSE).
