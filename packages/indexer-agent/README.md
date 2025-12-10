# Indexer Agent

## Usage

### `graph-indexer-agent start`

```
Start the agent

Indexer Infrastructure
  --indexer-management-port         Port to serve the indexer management API at
                                                        [number] [default: 8000]
  --metrics-port                    Port to serve Prometheus metrics at
                                                        [number] [default: 7300]
  --syncing-port                    Port to serve the network subgraph and other
                                    syncing data for indexer service at
                                                        [number] [default: 8002]
  --log-level                       Log level        [string] [default: "debug"]
  --polling-interval                Polling interval for data collection
                                                      [number] [default: 120000]
  --ipfs-endpoint                   IPFS endpoint for querying manifests.
              [string] [required] [default: "https://ipfs.network.thegraph.com"]
  --enable-auto-graft               Automatically deploy and sync graft
                                    dependencies for subgraphs
                                                      [boolean] [default: false]
  --graph-node-query-endpoint       Graph Node endpoint for querying subgraphs
                                                             [string] [required]
  --graph-node-status-endpoint      Graph Node endpoint for indexing statuses
                                    etc.                     [string] [required]
  --graph-node-admin-endpoint       Graph Node endpoint for applying and
                                    updating subgraph deployments
                                                             [string] [required]
  --enable-auto-migration-support   Auto migrate allocations from L1 to L2
                                    (multi-network mode must be enabled)
                                                      [boolean] [default: false]
  --deployment-management           Subgraph deployments management mode
                                   [choices: "auto", "manual"] [default: "auto"]
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

Postgres
  --postgres-host        Postgres host                       [string] [required]
  --postgres-port        Postgres port                  [number] [default: 5432]
  --postgres-username    Postgres username        [string] [default: "postgres"]
  --postgres-password    Postgres password                [string] [default: ""]
  --postgres-sslenabled  Postgres SSL Enabled       [boolean] [default: "false"]
  --postgres-database    Postgres database name              [string] [required]
  --postgres-pool-size   Postgres maximum connection pool size
                                                          [number] [default: 50]

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
  --confirmation-blocks           The number of blocks to wait for a transaction
                                  to be confirmed          [number] [default: 3]
  --mnemonic                      Mnemonic for the operator wallet
                                                             [string] [required]
  --indexer-address               Ethereum address of the indexer
                                                             [string] [required]
  --payments-destination          Address where payments are sent to. If not
                                  provided payments will be restaked.   [string]

Network Subgraph
  --network-subgraph-deployment   Network subgraph deployment 
                                                                        [string]
  --network-subgraph-endpoint     Endpoint to query the network subgraph from
                                                                        [string]
  --allocate-on-network-subgraph  Whether to allocate to the network subgraph
                                                      [boolean] [default: false]
  --epoch-subgraph-deployment     Epoch subgraph deployment (for local hosting)
                                                                        [string]

TAP Subgraph
  --tap-subgraph-deployment  TAP subgraph deployment                    [string]
  --tap-subgraph-endpoint    Endpoint to query the tap subgraph from    [string]

Protocol
  --epoch-subgraph-endpoint                Endpoint to query the epoch block
                                           oracle subgraph from
                                                             [string] [required]
  --subgraph-max-block-distance            How many blocks subgraphs are allowed
                                           to stay behind chain head
                                                        [number] [default: 1000]
  --subgraph-freshness-sleep-milliseconds  How long to wait before retrying
                                           subgraph query if it is not fresh
                                                        [number] [default: 5000]
  --default-allocation-amount              Default amount of GRT to allocate to
                                           a subgraph deployment
                                                        [number] [default: 0.01]
  --register                               Whether to register the indexer on
                                           chain       [boolean] [default: true]
  --max-provision-initial-size             The maximum number of tokens for the
                                           initial Subgraph Service provision
                                                           [number] [default: 0]

Query Fees
  --rebate-claim-threshold                  Minimum value of rebate for a single
                                            allocation (in GRT) in order for it
                                            to be included in a batch rebate
                                            claim on-chain [number] [default: 1]
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
                                            claim on-chain [number] [default: 1]
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

Disputes
  --poi-disputable-epochs   The number of epochs in the past to look for
                            potential POI disputes         [number] [default: 1]
  --poi-dispute-monitoring  Monitor the network for potential POI disputes
                                                      [boolean] [default: false]

Options:
  --version                        Show version number                 [boolean]
  --help                           Show help                           [boolean]
  --offchain-subgraphs             Subgraphs to index that are not on chain
                                   (comma-separated)       [array] [default: []]
  --horizon-address-book           Graph Horizon contracts address book file
                                   path                                 [string]
  --subgraph-service-address-book  Subgraph Service contracts address book file
                                   path                                 [string]
  --tap-address-book               TAP contracts address book file path [string]
  --chain-finalize-time            The time in seconds that the chain finalizes
                                   blocks               [number] [default: 3600]

```

### `graph-indexer-agent start` in Multi Network Mode

To use the Indexer Agent in Multi Network Mode, set the environment variable
`INDEXER_AGENT_MULTINETWORK_MODE` to `"true"` before running the command.

```
Start the Agent in multiple Protocol Networks

Indexer Infrastructure
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
  --enable-auto-migration-support  Auto migrate allocations from L1 to L2
                                   (multi-network mode must be enabled)
                                                      [boolean] [default: false]

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
