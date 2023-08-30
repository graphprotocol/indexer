# Indexer Service

## Usage

### `graph-indexer-service start`

```
Start the service

Ethereum
  --network-provider, --ethereum  Ethereum node or provider URL
                                                             [string] [required]
  --ethereum-polling-interval     Polling interval for the Ethereum provider
                                  (ms)                  [number] [default: 4000]
  --mnemonic                      Mnemonic for the operator wallet
                                                             [string] [required]
  --indexer-address               Ethereum address of the indexer
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
  --query-timing-logs           Log time spent on each query received
                                                      [boolean] [default: false]

Postgres
  --postgres-host      Postgres host                         [string] [required]
  --postgres-port      Postgres port                    [number] [default: 5432]
  --postgres-username  Postgres username          [string] [default: "postgres"]
  --postgres-password  Postgres password                  [string] [default: ""]
  --postgres-database  Postgres database name                [string] [required]

Network Subgraph
  --network-subgraph-deployment  Network subgraph deployment            [string]
  --network-subgraph-endpoint    Endpoint to query the network subgraph from
                                                             [string] [required]
  --network-subgraph-auth-token  Bearer token to require for /network queries
                                                                        [string]
  --serve-network-subgraph       Whether to serve the network subgraph at
                                 /network             [boolean] [default: false]
  --allocation-syncing-interval  Interval (in ms) for syncing indexer
                                 allocations from the network
                                                      [number] [default: 120000]

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

# Copyright

Copyright &copy; 2020 The Graph Foundation

Licensed under the [MIT license](LICENSE).
