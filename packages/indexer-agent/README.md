# Indexer Agent

## Usage

### `graph-indexer-agent start`

```
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
