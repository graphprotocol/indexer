# Indexer Errors

## IE001

**Summary**

The indexer agent is unable to run database migrations.

**Solution**

The agent is logging the error that causes the migrations to fail. There could
be numerous reasons. If the reason is not clear to you, check with the
community.

## IE002

**Summary**

The URL used to connect to Ethereum is invalid.

**Solution**

TODO

## IE003

**Summary**

Failed to index network subgraph.

**Solution**

TODO

## IE004

**Summary**

Failed to synchronize with network.

**Description**

The indexer agent has failed fetching network data from either the contracts
or the network subgraph, or has issues fetching current deployments and
indexing rules from its graph/index node or nodes or its own database.
Potential reasons for this:

- The Ethereum node or provider configured via `INDEXER_AGENT_ETHEREUM` or
  `--ethereum` is unhealthy or is rate limiting requests from the indexer.
- The network subgraph endpoint configured via
  `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT` or `--network-subgraph-endpoint` is
  unhealthy, cannot be reached for other reasons, or is outdated.
- There indexer agent is unable to reach the indexing status API of the graph/index
  node or nodes.
- The indexer agent is unable to obtain a database connection or the query for
  indexing rules fails for some reason.

As usual, the error message contains details about what is going wrong
specifically.

**Solution**

The solution depends on which of potential causes listed above is causing the
`IE004` error.

If the Ethereum node or provider is the culprit, switching the node or provider
or (in the case of a provider) upgrading the provider subscription may help.

If it is a connection issue between the indexer agent and graph/index node or
nodes, this is typically an issue specific to the indexer infrastructure and
needs to be investigated by the indexer. The same goes for database connection
issues.

If the network subgraph endpoint is unhealthy or throwing issues that suggest it
can be reached but is not behaving correctly, please collect the `IE004` error
logs and file an issue on <https://github.com/graphprotocol/indexer>:

```bash
grep <logs> | grep IE004
```

## IE005

**Summary**

Failed to reconcile indexer and network.

**Description**

The indexer agent failed performing one of the following actions:

1. Starting or stopping subgraph deployments that match the indexer's
   indexing rules.
2. Creating or closing allocations for subgraph deployments that match the
   indexer's indexing rules.
3. Claiming rebate rewards for already closed allocations.

The error message logged along with this error code includes details about
which of the above went wrong. Typical examples of problems that lead to
`IE005`:

- The indexer agent is unable to reach the graph/index node or nodes to
  create deployments.
- Allocation transactions fail due to a lack of ETH.
- The indexer has run out of free stake to allocate to subgraphs.

See also: [#IE013](#ie013), [#IE020](#ie020).

**Solution**

The solution depends on which of the above problems causes the `IE005` error
to be reported. Make sure that

- Indexer agent can connect and deploy to the graph/index node or nodes fine.
- The indexer has sufficient ETH.
- The indexer has sufficient free stake to create new allocations. If this is
  the case, reduce the allocation amount and/or parallel allocations on some
  of the deployments in the indexing rules and wait until some of the existing
  allocations have been closed and have released the allocated GRT again. In
  this case, the situation should resolve automatically.


## IE006

**Summary**

Failed to cross-check allocation state with contracts.

**Solution**

TODO

## IE007

**Summary**

Failed to check for network pause.

**Solution**

TODO

## IE008

**Summary**

Failed to check operator status for indexer.

**Solution**

TODO

## IE009

**Summary**

Failed to query subgraph deployments worth indexing.

**Description*

The indexer service or agent failed querying the network subgraph via the URL
defined in one of the following environment variables / command-line options:

- `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT` / `--network-subgraph-endpoint`
- `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT` / `--network-subgraph-endpoint`

There can be a nuber of reasons for this:

- The endpoint is unhealthy or unreliable.
- The endpoint is out of date.
- There are other networking issues between the indexer and the endpoint.

> **Note:** It is ok if this error shows up sporadically due to the network subgraph
> endpoint being rebooted or similar. However, if it keeps getting reported
> constantly, it will negatively impact the indexer's functionality.

**Solution**

Search the indexer service and agent logs for the `IE010` error code, e.g.
with

```bash
grep <logs> | grep IE010
```

File an issue on https://github.com/graphprotocol/indexer/issues with the
matching logs attached.

## IE010

**Summary**

Failed to query indexer allocations.

**Solution**

TODO

## IE011

**Summary**

Failed to query claimable indexer allocations.

**Solution**

TODO

## IE012

**Summary**

Failed to register indexer.

**Solution**

TODO

## IE013

**Summary**

Failed to allocate: insufficient free stake.

**Description**

This is a sub-error of `IE005`. It is reported when an indexer has locked up
all of their stake in existing allocations and there is no free stake to use
for creating new allocations

**Solution**

The indexer has sufficient free stake to create new allocations. If this is
the case, reduce the allocation amount and/or parallel allocations on some of
the deployments in the indexing rules and wait until some of the existing
allocations have been closed and have released the allocated GRT again. In
this case, the situation should resolve automatically.

## IE014

**Summary**

Failed to allocate: allocation not created on chain.

**Solution**

TODO

## IE015

**Summary**

Failed to close allocation.

**Solution**

TODO

## IE016

**Summary**

Failed to claim allocation.

**Solution**

TODO

## IE017

**Summary**

Failed to ensure default global indexing rule.

**Solution**

TODO

## IE018

**Summary**

Failed to query indexing status API.

**Solution**

TODO

## IE018

**Summary**

Failed to query proof of indexing.

**Solution**

TODO

## IE020

**Summary**

Failed to ensure subgraph deployment is indexing.

**Description**

This is a sub-error of `IE005`. It is reported when the indexer agent fails
to ensure that a subgraph deployment is deployed and being indexed on the
graph/index node or nodes.

Typical reasons that can cause this:

- The indexer agent fails to connect to the graph/index node or nodes.
- The subgraph deployment is for a network (e.g. Ropsten) that is not
  supported by the graph/index node or nodes.

**Solution**

Connection issues between the indexer agent and graph/index node or nodes are
specific to the indexer setup and need to be investigated on a case by case
basis.

If the subgraph network is not supported by the graph/index node or nodes,
this can be resolved by adding an Ethereum node or provider for this network
to the graph/index node configuration.

See also: [#IE026](#ie026).

## IE021

**Summary**

Failed to migrate cost model.

**Solution**

TODO

## IE022

**Summary**

Failed to identify attestation signer for allocation.

**Solution**

TODO

## IE023

**Summary**

Failed to handle state channel message.

**Solution**

TODO

## IE024

**Summary**

Failed to connect to indexing status API.

**Solution**

TODO

## IE025

**Summary**

Failed to query indexer management API.

**Solution**

TODO

## IE026

**Summary**

Failed to deploy subgraph deployment.

**Description**

This is a sub-error of `IE020`, with very much the same potential causes and
solutions.

## IE027

**Summary**

Failed to remove subgraph deployment.

**Solution**

TODO

## IE028

**Summary**

Failed to reassign subgraph deployment.

**Solution**

TODO

## IE029

**Summary**

Invalid X-Graph-Payment header provided.

**Solution**

TODO

## IE030

**Summary**

No X-Graph-Payment header provided.

**Solution**

TODO

## IE031

**Summary**

Invalid X-Graph-Payment value provided.

**Solution**

TODO

## IE032

**Summary**

Failed to process paid query.

**Description**

Failing to process a paid query can have a number of reasons:

- The indexer service is out of sync with the network. Specifically, it
  hasn't detected the allocations made by the indexer agent yet. The most
  likely cause for this is that the network subgraph endpoint specified via
  `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT` or `--network-subgraph-endpoint`
  is unhealthy and failing repeatedly. This particular situation would manifest
  itself in a `Unable to sign the query response attesattion` error message.
- The indexer service either fails to forward queries to the graph/query node
  or nodes, or the graph/query node or nodes fail to execute the query.
- The indexer service fails to push the payment or attestation into the
  server wallet, either due to a problem with the database or corrupt/invalid
  payment or receipt messages.

**Solution**

If there are no `IE010` errors before the `IE032`, the problem is most likely
in the gateway sending the query. In this case, please get in touch with the
Graph team.

Due to the complexity of this error message, the best advice is to grep the
indexer service logs for any `IE0*` errors and create an issue on
https://github.com/graphprotocol/indexer/issues:

```bash
grep <logs> | grep IE0
```

## IE033

**Summary**

Failed to process free query.

**Solution**

TODO
