# Subgraph Freshness Checker Feature

## Overview

The `SubgraphFreshnessChecker` class is introduced to enhance the reliability and timeliness of subgraph queries in environments where the subgraph might lag significantly behind the most recent block on the blockchain. It primarily operates by validating subgraph freshness and issuing warnings if the subgraph is not sufficiently synchronized with the latest blockchain state.

## Key Concepts

- **Subgraph Freshness:** A metric to determine how synchronized a subgraph is with the main blockchain. It's gauged by comparing the latest indexed block in the subgraph with the most recent block on the network.

## Feature Details

### 1. Continuous Retry Mechanism
The `SubgraphFreshnessChecker` perpetually retries subgraph queries under circumstances where the subgraph is notably behind the most recent block on the blockchain. A warning, including the current block distance from the chain head, is issued if this condition is detected.

### 2. Configuration
Configuration options have been expanded to allow control over the subgraph freshness checking mechanism via network specification files and Command Line Interface (CLI) parameters:

- **maxBlockDistance:** An integer defining the acceptable distance (in blocks) between the latest indexed block in the subgraph and the most recent block on the network. If the distance exceeds this value, the subgraph is considered "stale," prompting a retry mechanism and possibly a warning.

- **freshnessSleepMilliseconds:** An integer dictating the waiting duration (in milliseconds) before a query is retried when the subgraph is deemed stale.

### Example Configuration

Here is a snippet of an Arbitrum network specification file with the suggested options for Arbitrum One and Arbitrum Sepolia:

```yaml
subgraphs:
  maxBlockDistance: 5000
  freshnessSleepMilliseconds: 10000
```

## Practical Implications

The following default values have been established based on **Arbitrum-One** observations:

- **maxBlockDistance:** 1000 blocks
- **freshnessSleepMilliseconds:** 10000 (10 seconds)


### Potential Risk Warning

Suppose the Agent or Service utilizes the default (Ethereum) settings on Arbitrum networks. In that case, a warning will inform users about the risk that queries may forever be considered non-fresh.

Adjust the `maxBlockDistance` and `freshnessSleepMilliseconds` according to each network condition.

## Disabling this feature

This feature can be virtually turned off by setting a very high value for the **maxBlockDistance** option, which will effectively cause the freshness check always to pass.
