# Graph Protocol Indexer CLI

## Installation

The indexer CLI in this repository is an extension for [graph-cli](https://github.com/graphprotocol/graph-cli).
As such they are best installed together.

```sh
npm install -g @graphprotocol/graph-cli
npm install -g @graphprotocol/indexer-cli
```

## Usage

Getting help:

```sh
$ graph indexer --help

Manage indexer configuration

  indexer status                      Check the status of an indexer
  indexer rules                       Configure indexing rules
  indexer rules stop (never)          Never index a deployment (and stop indexing it if necessary)
  indexer rules start (always)        Always index a deployment (and start indexing it if necessary)
  indexer rules prepare (offchain)    Offchain index a deployment (good practice to prepare indexing)
  indexer rules set                   Set one or more indexing rules
  indexer rules maybe                 Index a deployment based on rules
  indexer rules get                   Get one or more indexing rules
  indexer rules delete                Remove one or many indexing rules
  indexer rules clear (reset)         Clear one or more indexing rules
  indexer disputes                    POI monitoring
  indexer disputes get                Cross-check POIs submitted in the network
  indexer cost                        Manage costing for subgraphs
  indexer cost set variables          Update cost model variables
  indexer cost set model              Update a cost model
  indexer cost get                    Get cost models and/or variables for one or all subgraphs
  indexer connect                     Connect to indexer management API
  indexer                             Manage indexer configuration
```

Connecting to an indexer management API:

```sh
$ graph indexer connect http://url.of.indexer-agent:8000/
```

Querying indexing rules:

```sh
$ graph indexer rules get all
╔════════════════════════════════════════════════════════════════════╤══════════════════════╤═════════════════════════╤═══════════╤═══════════╤══════════╤═════════════════════╤════════╤═══════════════╗
║ deployment                                                         │ allocation           │ maxAllocationPercentage │ minSignal │ maxSignal │ minStake │ minAverageQueryFees │ custom │ decisionBasis ║
╟────────────────────────────────────────────────────────────────────┼──────────────────────┼─────────────────────────┼───────────┼───────────┼──────────┼─────────────────────┼────────┼───────────────╢
║ global                                                             │ 0.000000000000000001 │                         │           │           │          │                     │        │ rules         ║
╟────────────────────────────────────────────────────────────────────┼──────────────────────┼─────────────────────────┼───────────┼───────────┼──────────┼─────────────────────┼────────┼───────────────╢
║ 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3 │                      │                         │           │           │          │                     │        │ always        ║
╚════════════════════════════════════════════════════════════════════╧══════════════════════╧═════════════════════════╧═══════════╧═══════════╧══════════╧═════════════════════╧════════╧═══════════════╝
```

Start subgraph deployments:

```sh
$ graph indexer rules start 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3
╔════════════════════════════════════════════════════════════════════╤════════════╤═════════════════════════╤═══════════╤═══════════╤══════════╤═════════════════════╤════════╤═══════════════╗
║ deployment                                                         │ allocation │ maxAllocationPercentage │ minSignal │ maxSignal │ minStake │ minAverageQueryFees │ custom │ decisionBasis ║
╟────────────────────────────────────────────────────────────────────┼────────────┼─────────────────────────┼───────────┼───────────┼──────────┼─────────────────────┼────────┼───────────────╢
║ 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3 │            │                         │           │           │          │                     │        │ always        ║
╚════════════════════════════════════════════════════════════════════╧════════════╧═════════════════════════╧═══════════╧═══════════╧══════════╧═════════════════════╧════════╧═══════════════╝
```

Offchain index subgraph:

```sh
$ graph indexer rules offchain 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3
╔════════════════════════════════════════════════════════════════════╤════════════╤═════════════════════════╤═══════════╤═══════════╤══════════╤═════════════════════╤════════╤═══════════════╗
║ deployment                                                         │ allocation │ maxAllocationPercentage │ minSignal │ maxSignal │ minStake │ minAverageQueryFees │ custom │ decisionBasis ║
╟────────────────────────────────────────────────────────────────────┼────────────┼─────────────────────────┼───────────┼───────────┼──────────┼─────────────────────┼────────┼───────────────╢
║ 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3 │            │                         │           │           │          │                     │        │ offchain      ║
╚════════════════════════════════════════════════════════════════════╧════════════╧═════════════════════════╧═══════════╧═══════════╧══════════╧═════════════════════╧════════╧═══════════════╝
```

Stopping subgraph deployments:

```sh
$ graph indexer rules stop 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3
╔════════════════════════════════════════════════════════════════════╤════════════╤═════════════════════════╤═══════════╤═══════════╤══════════╤═════════════════════╤════════╤═══════════════╗
║ deployment                                                         │ allocation │ maxAllocationPercentage │ minSignal │ maxSignal │ minStake │ minAverageQueryFees │ custom │ decisionBasis ║
╟────────────────────────────────────────────────────────────────────┼────────────┼─────────────────────────┼───────────┼───────────┼──────────┼─────────────────────┼────────┼───────────────╢
║ 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3 │            │                         │           │           │          │                     │        │ never         ║
╚════════════════════════════════════════════════════════════════════╧════════════╧═════════════════════════╧═══════════╧═══════════╧══════════╧═════════════════════╧════════╧═══════════════╝
```

Tweak global indexing rules:

```sh
$ graph indexer rules set global minSignal 10000 minAverageQueryFees 50
╔════════════╤══════════════════════╤═════════════════════════╤═══════════╤═══════════╤══════════╤═════════════════════╤════════╤═══════════════╗
║ deployment │ allocation           │ maxAllocationPercentage │ minSignal │ maxSignal │ minStake │ minAverageQueryFees │ custom │ decisionBasis ║
╟────────────┼──────────────────────┼─────────────────────────┼───────────┼───────────┼──────────┼─────────────────────┼────────┼───────────────╢
║ global     │ 0.000000000000000001 │                         │ 10000.0   │           │          │ 50.0                │        │ rules         ║
╚════════════╧══════════════════════╧═════════════════════════╧═══════════╧═══════════╧══════════╧═════════════════════╧════════╧═══════════════╝
```

Tweak deployment specific indexing rules:

```sh
$ graph indexer rules set 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3 decisionBasis rules minStake 999
╔════════════════════════════════════════════════════════════════════╤════════════╤═════════════════════════╤═══════════╤═══════════╤══════════╤═════════════════════╤════════╤═══════════════╗
║ deployment                                                         │ allocation │ maxAllocationPercentage │ minSignal │ maxSignal │ minStake │ minAverageQueryFees │ custom │ decisionBasis ║
╟────────────────────────────────────────────────────────────────────┼────────────┼─────────────────────────┼───────────┼───────────┼──────────┼─────────────────────┼────────┼───────────────╢
║ 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3 │            │                         │           │           │ 999.0    │                     │        │ rules         ║
╚════════════════════════════════════════════════════════════════════╧════════════╧═════════════════════════╧═══════════╧═══════════╧══════════╧═════════════════════╧════════╧═══════════════╝
```

Clear indexing rules:

```sh
$ graph indexer rules clear 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3 minStake
╔════════════════════════════════════════════════════════════════════╤════════════╤═════════════════════════╤═══════════╤═══════════╤══════════╤═════════════════════╤════════╤═══════════════╗
║ deployment                                                         │ allocation │ maxAllocationPercentage │ minSignal │ maxSignal │ minStake │ minAverageQueryFees │ custom │ decisionBasis ║
╟────────────────────────────────────────────────────────────────────┼────────────┼─────────────────────────┼───────────┼───────────┼──────────┼─────────────────────┼────────┼───────────────╢
║ 0xa4e311bfa7edabed7b31d93e0b3e751659669852ef46adbedd44dc2454db4bf3 │            │                         │           │           │          │                     │        │ rules         ║
╚════════════════════════════════════════════════════════════════════╧════════════╧═════════════════════════╧═══════════╧═══════════╧══════════╧═════════════════════╧════════╧═══════════════╝
```

# Working with the repo

## CLI tests

The CLI tests execute the command externally and use a directory of reference files as the expected
outputs. In order to create new reference files it is recommended to use the following steps. 

- Install `strip-ansi` to strip ansi color codes from CLI command stdout and stderr output
  - `npm install --global strip-ansi-cli`
- Produce reference output file by piping command output through stip-ansi before saving to file
  - Ex: `./bin/graph-indexer indexer rules get | strip-ansi | src/__tests__/references/indexer-rules-command-no-args.stdout`

# Copyright

Copyright &copy; 2020 The Graph Foundation

Licensed under the [MIT license](LICENSE).
