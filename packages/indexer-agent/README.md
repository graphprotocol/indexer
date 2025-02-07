# Indexer Agent

## Usage

### `graph-indexer-agent start`

```
Start the agent

Ethereum
  --network-provider, --ethereum  Ethereum node or provider URL
                                                             [string] [required]
  --ethereum-polling-interval     Polling interval for the Ethereum provider
                                  (ms)                  [number] [default: 4000]
  --gas-increase-timeout          Time (in seconds) after which transactions
                                  will be resubmitted with a higher gas price
                                                         [number] [default: 240]
  --gas-increase-factor           Factor by which gas prices are increased when
                                  resubmitting transactions
                                                         [number] [default: 1.2]
  --gas-price-max                 The maximum gas price (gwei) to use for
                                  transactions
                                            [deprecated] [number] [default: 100]
  --base-fee-per-gas-max          The maximum base fee per gas (gwei) to use for
                                  transactions, for legacy transactions this
                                  will be treated as the max gas price  [number]
  --transaction-attempts          The maximum number of transaction attempts
                                  (Use 0 for unlimited)    [number] [default: 0]
  --mnemonic                      Mnemonic for the operator wallet
                                                             [string] [required]
  --indexer-address               Ethereum address of the indexer
                                                             [string] [required]

Indexer Infrastructure
  --index-node-ids                  Node IDs of Graph nodes to use for indexing
                                    (separated by commas)     [array] [required]
  --indexer-management-port         Port to serve the indexer management API at
                                                        [number] [default: 8000]
  --metrics-port                    Port to serve Prometheus metrics at
                                                        [number] [default: 7300]
  --syncing-port                    Port to serve the network subgraph and other
                                    syncing data for indexer service at
                                                        [number] [default: 8002]
  --log-level                       Log level        [string] [default: "debug"]
  --graph-node-query-endpoint       Graph Node endpoint for querying subgraphs
                                                             [string] [required]
  --graph-node-status-endpoint      Graph Node endpoint for indexing statuses
                                    etc.                     [string] [required]
  --graph-node-admin-endpoint       Graph Node endpoint for applying and
                                    updating subgraph deployments
                                                             [string] [required]
  --public-indexer-url              Indexer endpoint for receiving requests from
                                    the network              [string] [required]
  --indexer-geo-coordinates         Coordinates describing the Indexer's
                                    location using latitude and longitude
                                  [string] [default: ["31.780715","-41.179504"]]
  --restake-rewards                 Restake claimed indexer rewards, if set to
                                    'false' rewards will be returned to the
                                    wallet             [boolean] [default: true]
  --allocation-management           Indexer agent allocation management
                                    automation mode (auto|manual)
                                                      [string] [default: "auto"]
  --auto-allocation-min-batch-size  Minimum number of allocation transactions
                                    inside a batch for auto allocation
                                    management. No obvious upperbound, with
                                    default of 1           [number] [default: 1]

Network Subgraph
  --network-subgraph-deployment   Network subgraph deployment           [string]
  --network-subgraph-endpoint     Endpoint to query the network subgraph from
                                                                        [string]
  --allocate-on-network-subgraph  Whether to allocate to the network subgraph
                                                      [boolean] [default: false]

Protocol
  --epoch-subgraph-endpoint    Endpoint to query the epoch block oracle subgraph
                               from                          [string] [required]
  --default-allocation-amount  Default amount of GRT to allocate to a subgraph
                               deployment               [number] [default: 0.01]
  --register                   Whether to register the indexer on chain
                                                       [boolean] [default: true]
Query Fees
  --rebate-claim-threshold                  Minimum value of rebate for a single
                                            allocation (in GRT) in order for it
                                            to be included in a batch rebate
                                            claim on-chain
                                                         [number] [default: 1]
  --rebate-claim-batch-threshold            Minimum total value of all rebates
                                            in an batch (in GRT) before the
                                            batch is claimed on-chain
                                                        [number] [default: 5]
  --rebate-claim-max-batch-size             Maximum number of rebates inside a
                                            batch. Upper bound is constrained by
                                            available system memory, and by the
                                            block gas limit
                                                         [number] [default: 100]
  --voucher-redemption-threshold            Minimum value of rebate for a single
                                            allocation (in GRT) in order for it
                                            to be included in a batch rebate
                                            claim on-chain
                                                         [number] [default: 1]
  --voucher-redemption-batch-threshold      Minimum total value of all rebates
                                            in an batch (in GRT) before the
                                            batch is claimed on-chain
                                                        [number] [default: 5]
  --voucher-redemption-max-batch-size       Maximum number of rebates inside a
                                            batch. Upper bound is constrained by
                                            available system memory, and by the
                                            block gas limit
                                                         [number] [default: 100]
  --gateway-endpoint,                       Gateway endpoint base URL
  --collect-receipts-endpoint                                [string] [required]

Postgres
  --postgres-host       Postgres host                        [string] [required]
  --postgres-port       Postgres port                   [number] [default: 5432]
  --postgres-username   Postgres username         [string] [default: "postgres"]
  --postgres-password   Postgres password                 [string] [default: ""]
  --postgres-database   Postgres database name               [string] [required]
  --postgres-pool-size  Postgres maximum connection pool size
                                                          [number] [default: 50]
Disputes
  --poi-disputable-epochs   The number of epochs in the past to look for
                            potential POI disputes         [number] [default: 1]
  --poi-dispute-monitoring  Monitor the network for potential POI disputes
                                                      [boolean] [default: false]

Options:
  --version             Show version number                            [boolean]
  --help                Show help                                      [boolean]
  --offchain-subgraphs  Subgraphs to index that are not on chain
                        (comma-separated)                  [array] [default: []]

```

### `graph-indexer-agent start` in Multi Network Mode

To use the Indexer Agent in Multi Network Mode, set the environment variable
`INDEXER_AGENT_MULTINETWORK_MODE` to `"true"` before running the command.

```
Start the Agent in multiple Protocol Networks

Indexer Infrastructure
  --index-node-ids                 Node IDs of Graph nodes to use for indexing
                                   (separated by commas)      [array] [required]
  --indexer-management-port        Port to serve the indexer management API at
                                                        [number] [default: 8000]
  --metrics-port                   Port to serve Prometheus metrics at
                                                        [number] [default: 7300]
  --syncing-port                   Port to serve the network subgraph and other
                                   syncing data for indexer service at
                                                        [number] [default: 8002]
  --log-level                      Log level         [string] [default: "debug"]
  --graph-node-query-endpoint      Graph Node endpoint for querying subgraphs
                                                             [string] [required]
  --graph-node-status-endpoint     Graph Node endpoint for indexing statuses
                                   etc.                      [string] [required]
  --graph-node-admin-endpoint      Graph Node endpoint for applying and updating
                                   subgraph deployments      [string] [required]

Postgres
  --postgres-host       Postgres host                        [string] [required]
  --postgres-port       Postgres port                   [number] [default: 5432]
  --postgres-username   Postgres username         [string] [default: "postgres"]
  --postgres-password   Postgres password                 [string] [default: ""]
  --postgres-database   Postgres database name               [string] [required]
  --postgres-pool-size  Postgres maximum connection pool size
                                                          [number] [default: 50]

Options:
  --version                                 Show version number        [boolean]
  --help                                    Show help                  [boolean]
  -p-offchain-subgraphs                      Subgraphs to index that are not on
                                            chain (comma-separated)
                                                           [array] [default: []]
  --network-specifications-directory,       Path to a directory containing
  --dir                                     network specification files
                                                             [string] [required]
```

# Copyright

Copyright &copy; 2020 The Graph Foundation

Licensed under the [MIT license](LICENSE).
