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

Manage indexing rules and prices

  indexer                        Manage indexing rules and prices
  indexer connect                Connect to indexer management API
  indexer rules                  Configure indexing rules
  indexer rules always (start)   Always index a deployment (and start indexing it if necessary)
  indexer rules clear (reset)    Clear one or more indexing rules
  indexer rules get              Get one or more indexing rules
  indexer rules maybe            Index a deployment based on rules
  indexer rules never (stop)     Never index a deployment (and stop indexing it if necessary)
  indexer rules set              Set one or more indexing rules
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
