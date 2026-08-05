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
  the case, reduce the allocation amount until some of the existing 
  allocations have been closed and have released the allocated GRT again. 
  In this case, the situation should resolve automatically.

## IE006

**Summary**

Failed to cross-check allocation state with contracts.

**Solution**

TODO

## IE007

**Summary**

Failed to check for network pause.

**Solution**

Reference IE004. 

## IE008

**Summary**

Failed to check operator status for indexer.

**Solution**

TODO

## IE009

**Summary**

Failed to query subgraph deployments worth indexing.

**Description**

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
the case, reduce the allocation amount on some of the deployments in the 
indexing rules and wait until some of the existing allocations have been 
closed and have released the allocated GRT again. In this case, the 
situation should resolve automatically.

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

## IE019

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

Invalid Scalar-Receipt header provided.

**Solution**

TODO

## IE030

**Summary**

No Scalar-Receipt header provided.

**Solution**

TODO

## IE031

**Summary**

Invalid Scalar-Receipt value provided.

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

## IE034

**Summary**

Not authorized as an operator for the indexer.

**Description**

This error is reported when the indexer and operator addresses are different
and the operator address is not registered as an operator for the indexer.

**Solution**

Add the operator address to your indexer in the explorer. The operator address
is included in the error message.

## IE035

**Summary**

An asynchronous operation (promise) failed somewhere in the system but this
error wasn't handled. A frequent cause for these are failed promises internal to
ethers.js, which have caused indexer-agent and index-service to crash.

**Solution**

If this error is related to ethers.js and Ethereum requests, there _may_ be
issues with your Ethereum node or provider, but it may also simply be an
internal error in ethers.js, in which case you can ignore this error.

If the error is _not_ related to Ethereum requests, it is likely to be an
unhandled error in indexer-agent and is best reported as an
issue on https://github.com/graphprotocol/indexer/issues.

## IE036

**Summary**

An operation failed somewhere in the system but this error wasn't handled.

**Solution**

This is likely to be an unhandled error in indexer-agent and
is best reported as an issue on https://github.com/graphprotocol/indexer/issues.

## IE037

**Summary**

TODO

**Solution**

TODO

## IE038

**Summary**

TODO

**Solution**

TODO

## IE039

**Summary**

TODO

**Solution**

TODO

## IE040

**Summary**

TODO

**Solution**

TODO

## IE041

**Summary**

There is a problem looking up Vector transfers for closed allocations from
the database. This is most likely due to a database connection issue.

**Solution**

Check the logs for details about database issues. It could be that
the database cannot be reached for some reason.

## IE042

**Summary**

A Vector transfer cannot be stored in the database. Most likely, this is a
database connection error but it could also be a bug caused by a conflict
with data that is already in the database. The error cause in the logs should
reveal what the exact problem is.

**Solution**

See also: [#IE041](#ie041).

## IE043

**Summary**

A Vector transfer cannot be marked as resolved in the database. Most likely,
this is a database connection error but it could also be a bug caused by a
conflict with data that is already in the database. The error cause in the
logs should reveal what the exact problem is.

**Solution**

See also: [#IE041](#ie041).

## IE044

**Summary**

Failed to collect query fees on chain.

**Solution**

TODO

## IE045

**Summary**

Failed to queue transfers for resolving.

**Solution**

TODO

## IE046

**Summary**

Failed to resolve transfer.

**Solution**

TODO

## IE047

**Summary**

Failed to mark transfer as failed.

**Solution**

TODO

## IE048

**Summary**

Failed to withdraw query fees for allocation.

**Solution**

TODO

## IE049

**Summary**

Failed to clean up transfers for allocation.

**Solution**

TODO

## IE050

**Summary**

Transaction reverted due to gas limit being hit.

**Solution**

TODO

## IE051

**Summary**

Transaction reverted for unknown reason.

**Solution**

TODO

## IE052

**Summary**

Transaction aborted: maximum configured gas price reached.

**Solution**

TODO

## IE053

**Summary**

Failed to queue receipts for collecting.

**Solution**

TODO

## IE054

**Summary**

Failed to collect receipts in exchange for query fee voucher.

**Solution**

TODO

## IE055

**Summary**

Failed to redeem query fee voucher.

**Solution**

TODO

## IE056

**Summary**

Failed to remember allocation for collecting receipts later.

**Solution**

TODO

## IE057

**Summary**

Transaction reverted due to failing assertion in contract.

**Solution**

TODO

## IE058

**Summary**

Transaction failed because nonce has already been used.

**Solution**

TODO

## IE059

**Summary**

Failed to check latest operator ETH balance.

**Solution**

TODO

## IE060

**Summary**

Failed to allocate: subgraph is already allocated to.

**Solution**

The Indexer already has an active allocation on this subgraph so a new one cannot be created. This error can typically be ignored.

## IE061

**Summary**

Failed to allocate: Invalid allocation amount provided.

**Solution**

Allocation amounts must be non-negative numbers. To resolve this issue ensure the corresponding indexer rule and/or action queue item have `allocationAmount` specified to be greater or equal to 0.

## IE062

**Summary**

Action was not executed successfully: contracts paused or operator not authorized.

**Solution**

Cannot confirm `allocateFrom`, `closeAllocation`, or `closeAndAllocate` transactions completed successfully. Please ensure the indexer operator is authorized, calls to the network contracts from your indexer-agent machine can be made, and the network is not paused.

## IE063

**Summary**

Failed to unallocate: No active allocation with provided id found.

**Solution**

The Indexer must have an active allocation to perform an unallocate action on that subgraph deployment. Please ensure the correct allocation id for an existing active allocation is provided.

## IE064

**Summary**

Failed to unallocate: Allocations cannot be closed during this epoch as it was created in this epoch.

**Solution**

An allocation cannot be closed within the same epoch that it was created in. Wait until the next epoch and the error should resolve and the unallocate action will be executed.

## IE065

**Summary**

Failed to unallocate: Allocation has already been closed.

**Solution**

Check the allocation ID and network sync status. If the allocation ID is correct and allocation is closed, then there's nothing to be done. 

## IE066

**Summary**

Allocation not created: Allocation ID already exist.

**Solution**

Duplicate allocation ids are not permitted. Check the network subgraph sync status, if it is caught up and an allocation still needs to be opened, agent will create a new unique allocation ID and try again.

## IE067

**Summary**

Failed to resolve POI: POI not available for deployment at current epoch start block.

**Solution**

This error typically indicates a subgraph deployment that is too far behind the chain head to resolve a valid POI for closing the allocation. To successfully resolve the POI and close the allocation you'll need to wait for the index node to sync the deployment enough to generate a POI for the current epoch start block. If you do not want to wait to sync you may choose to forfeit indexing rewards for the allocation by force closing it with a 0 POI by creating an unallocate or reallocate action item: `graph indexer actions queue unallocate/reallocate <deployment-id> <allocation-id> 0 true`.

## IE068

**Summary**

Failed to resolve POI: User provided POI does not match reference fetched from the graph-node.

**Solution**

Check sync and health status of the subgraph to access the issue. If needed, provide a POI or use `--force` to bypass POI checks. 

## IE069

**Summary**

Failed to query Epoch Block Oracle Subgraph

**Solution**

Check `epoch-subgraph-endpoint` query endpoint for its syncing status and the EBO contract state. 

## IE070

**Summary**

Failed to query BlockHashFromNumber from graph node

**Solution**

Graph-node could not find the block hash given network and block number, check if graph-node has access to a network client that has synced to the required block, and ensure indexer agent is connect to the index node configured with an RPC endpoint from the required network

## IE071

**Summary**

Epoch subgraph required for subgraphs indexing networks in which rpc is unprovided to the indexer agent

**Description**

This is a sub-error of `IE069`. It is reported when the indexer agent doesn't have access to an epoch subgraph endpoint to identify the epoch start block for chains other than the settlement network as indicated by start-up option `--ethereum-network`. 

**Solution**

Please provide a `epoch-subgraph-endpoint` and make sure graph node has consistent network configurations (`mainnet`, `sepolia`, `gnosis`) and is on or after version 0.28.0.

## IE072

**Summary**

Failed to execute batch transaction on the staking contract.

**Description**

The indexer agent submits approved actions (e.g. allocate, unallocate,
reallocate) to the staking contract as a single batched transaction. This
error is reported when that batched transaction fails to execute. The
underlying error returned by the contract call is included in the logs.

**Solution**

Check the logged error cause for the specific revert reason. Common causes
are insufficient ETH for gas, the operator not being authorized, the network
being paused, or one of the batched actions being individually invalid.
Resolve the underlying cause and the agent will retry the batch.

## IE073

**Summary**

Failed to query subgraph features from the indexing statuses endpoint.

**Description**

The indexer failed to fetch a subgraph deployment's feature set (the
`subgraphFeatures` query) from the graph/index node status API. This can
happen if the deployment is not known to the graph/index node, or the status
endpoint is unreachable or returned an error.

**Solution**

Verify the graph/index node status endpoint is reachable from the indexer and
that the subgraph ID is valid and known to the node. Check the graph/index
node logs for related errors.

## IE074

**Summary**

Failed to deploy subgraph deployment: network not supported.

**Description**

This is a more specific form of `IE026`. It is reported when the indexer
agent tries to deploy a subgraph deployment to the graph/index node or nodes
for a network that the node is not configured to support.

**Solution**

Add an Ethereum node or provider for the required network to the graph/index
node configuration so it can index the deployment's chain.

See also: [#IE026](#ie026).

## IE075

**Summary**

Failed to connect to the network contracts.

**Description**

On startup the indexer resolves the set of protocol contracts it needs (e.g.
`HorizonStaking`, `SubgraphService`, `EpochManager` and, before Horizon,
`LegacyServiceRegistry`). This error is logged as fatal and the process exits
when one or more required contracts cannot be found for the configured
network. The log lists which required contracts were missing.

**Solution**

Ensure the indexer is configured for a supported network and chain ID, that
the contracts for that network are deployed and discoverable, and that the
RPC endpoint used to resolve contract addresses is healthy.

## IE076

**Summary**

Failed to resume subgraph deployment.

**Description**

The indexer agent's `subgraph_resume` request to the graph/index node failed,
so the deployment could not be resumed from a paused state. The logged error
cause contains details.

**Solution**

Check that the graph/index node admin endpoint is reachable and that the
deployment exists on the node. This is analogous to the pause failure in
`IE027`.

## IE077

**Summary**

Failed to allocate: subgraph deployment is not syncing.

**Description**

Before opening an allocation, the indexer agent checks that the target
subgraph deployment is syncing and healthy on the graph/index node. This error
is reported when no indexing status is found for the deployment, meaning the
node is not (yet) indexing it.

**Solution**

Ensure the deployment has been created/assigned on the graph/index node and is
syncing before allocating to it. Wait for the deployment to appear in the
indexing statuses, then retry the allocate action.

## IE078

**Summary**

No provision found for the indexer and data service.

**Description**

This is a Graph Horizon error. The network monitor queried the network
subgraph for the indexer's provision to the given data service (the Subgraph
Service) and found none. A provision is required to operate under Horizon.

**Solution**

Create a provision to the Subgraph Service for your indexer before performing
Horizon actions. Verify the indexer and data service addresses are correct and
that the network subgraph is synced.

## IE079

**Summary**

Failed to add stake to provision: invalid stake amount provided.

**Description**

This is a Graph Horizon error. The amount of GRT provided to add to a
provision was negative.

**Solution**

Provide a non-negative (positive) GRT stake amount when adding to a provision.

## IE080

**Summary**

Failed to add stake to provision: stake not added on chain.

**Description**

This is a Graph Horizon error. The `addToProvision` transaction was submitted
but the expected `ProvisionIncreased` event was not found, so the stake was
not confirmed added on chain (the transaction was never mined).

**Solution**

Check that the operator has sufficient ETH for gas and that transactions from
the agent are being mined. Verify network status and retry. Note that if the
transaction result was `paused` or `unauthorized`, an `IE062` is reported
instead.

## IE081

**Summary**

Multiple provisions found for the indexer and data service.

**Description**

This is a Graph Horizon error. The network monitor expected exactly one
provision for the indexer/data service pair but found more than one.

**Solution**

This is unexpected. Review the indexer's provisions on chain and in the
network subgraph. If the state cannot be explained, collect the logs and file
an issue on https://github.com/graphprotocol/indexer/issues.

## IE082

**Summary**

Graph Horizon protocol not detected.

**Description**

A Horizon-only operation (such as querying or managing provisions) was
attempted on a network where the Graph Horizon protocol upgrade has not been
detected.

**Solution**

Provisions and related actions only apply after the Graph Horizon upgrade.
Ensure you are operating on a network where Horizon is live and that the
indexer's contract configuration is up to date.

## IE083

**Summary**

Failed to thaw stake from provision.

**Description**

This is a Graph Horizon error. Thawing stake from a provision failed. Causes
include a non-positive thaw amount, attempting to thaw more than the tokens
available in the provision, or the `thaw` transaction not being mined (the
expected `ProvisionThawed` event was not found).

**Solution**

Provide a positive thaw amount that is less than or equal to the tokens
available in the provision. If the transaction failed to mine, ensure the
operator has sufficient ETH and the network is healthy, then retry. The logged
error cause identifies which case applies.

## IE084

**Summary**

Could not resolve POI block number.

**Description**

While resolving a POI, no block number could be generated from the graph/index
node and none was provided by the user.

**Solution**

Provide a block number for the POI, or ensure the graph/index node can
generate one (the deployment must be synced far enough), then retry.

## IE085

**Summary**

Could not resolve public POI.

**Description**

While resolving a public POI, none could be generated from the graph/index
node and none was provided by the user.

**Solution**

Provide a public POI, or ensure the graph/index node can generate one for the
deployment at the target block, then retry.

## IE086

**Summary**

Indexer not registered in the Subgraph Service.

**Description**

This is a Graph Horizon error. When opening or reallocating an allocation
under Horizon, the agent checks that the indexer is registered with the
Subgraph Service (has a non-empty service URL). This error is thrown
automatically when the indexer is not yet registered, to give clearer feedback
during the transition period.

**Solution**

Register your indexer with the Subgraph Service (set your service URL / register
on chain) before allocating, then retry the allocation.

## IE087

**Summary**

Failed to resize allocation.

**Description**

The agent failed to prepare the `resizeAllocation` transaction for an
allocation on the Subgraph Service. The logged error contains the underlying
cause.

**Solution**

Check that the allocation ID and new amount are valid and that the Subgraph
Service contract call can be made from the agent. Review the logged error
cause for details.

## IE088

**Summary**

Failed to present POI.

**Description**

This is a Graph Horizon error associated with the "present POI" action, which
collects indexing rewards for an allocation by presenting a POI *without*
closing the allocation (`graph indexer allocations present-poi`, or the
`presentPOI` mutation). Presenting a POI resolves the POI against the
graph/index node and submits a `collect` transaction to the Subgraph Service.

Note: in the current indexer codebase this code is defined but is not raised on
its own. Failures in the present-POI flow surface through the more specific
codes it depends on — `IE065` if the allocation is already closed, `IE062` if
the transaction is rejected because the network is paused or the operator is
not authorized, and `IE089` if the `collect` transaction is never mined — or as
the underlying error itself.

**Solution**

Diagnose present-POI failures via the specific code reported in the logs:
`IE065` (allocation already closed), `IE062` (network paused / operator not
authorized), or `IE089` (transaction not mined). Ensure the allocation is still
active, the operator is authorized and funded with ETH for gas, and the POI can
be resolved for the deployment at the target block.

See also: [#IE062](#ie062), [#IE065](#ie065), [#IE089](#ie089).

## IE089

**Summary**

Failed to collect indexing rewards.

**Description**

This is a Graph Horizon error. When collecting indexing rewards for an
allocation via the Subgraph Service, the `collect` transaction was submitted
but the expected `ServicePaymentCollected` event was not found, i.e. the
transaction was never successfully mined.

**Solution**

Ensure the operator has sufficient ETH for gas, that the network is not paused,
and that the operator is authorized (a `paused`/`unauthorized` result is
reported separately as `IE062`). Verify transactions are being mined, then
retry.

## IE090

**Summary**

Failed to reallocate: indexer is overallocated.

**Description**

This is a Graph Horizon error. It is reported on reallocate paths when the
indexer is over-allocated on the Subgraph Service. In this situation the
`collect` step would automatically close the existing allocation while the new
allocation is rejected, leaving the indexer with no allocation on the
deployment. To prevent that, the agent checks for over-allocation first and
aborts the reallocation. The error message includes the amount (in GRT) by
which the indexer is over-allocated.

**Solution**

Close the allocation directly with `graph indexer allocations close`, which
handles over-allocation gracefully and still collects rewards, or add provision
tokens to reduce the over-allocation before retrying the reallocate action.
