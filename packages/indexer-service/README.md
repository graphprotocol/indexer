# Indexer Service

## Usage

### `graph-indexer-service start`

```
Start the service

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

# Copyright

Copyright &copy; 2020 The Graph Foundation

Licensed under the [MIT license](LICENSE).
