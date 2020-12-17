# Indexer Agent

## Usage

### `graph-indexer-agent start`

```
Start the agent

Ethereum
  --ethereum                   Ethereum node or provider URL [string] [required]
  --ethereum-network           Ethereum network    [string] [default: "rinkeby"]
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

Cost Models
  --inject-dai  Inject the GRT per DAI conversion rate into cost model variables
                                                       [boolean] [default: true]

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

# Copyright

Copyright &copy; 2020 The Graph Foundation

Licensed under the [MIT license](LICENSE).
