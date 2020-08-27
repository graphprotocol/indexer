# Indexer Service

## Usage

### `graph-indexer-service start`

```
Start the service

Ethereum
  --ethereum  Ethereum node or provider URL                  [string] [required]

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
  --mnemonic               Ethereum wallet mnemonic          [string] [required]
  --free-query-auth-token  Auth token that clients can use to query for free
                                                                         [array]
```
