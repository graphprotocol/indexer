# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.20.23] - 2023-09-29
### Added
- Subgraph Freshness check for Epoch and Network subgraphs
- `manual` deployment management mode

### Fixed
- Deprecate old payment systems after Exponential Rebates contract changes
- Updated README files

## [0.20.22] - 2023-08-28
### Fixed
- Fixed bug causing the network subgraph to be removed after syncing

## [0.20.21] - 2023-08-22
### Fixed
- Add missing fields when parsing network specification from CLI options

### Changed
- Upgraded `common-ts` dependency to v2.0.3

## [0.20.20] - 2023-08-21
### Fixed
- Properly skip reconciling allocations on a network in MANUAL mode
- Missing string interpolation in migration file
- Indexer registration was running for already registered indexers

## [0.20.19] - 2023-08-18
### Fixed
- Contract interface changes involving Exponential Rebates
- Included the protocolNetwork field when checking for duplicate action targets

### Added
- Enforced active connections with Graph-Node and the database during startup
- PostgreSQL connection pool size can be configured with the `postgres-pool-size` *(defaults to `50`)*.

### Changed
- Skip dispute checking on epochs with unavailable start block hash

## [0.20.18] - 2023-08-11
### Added
- A new migration to add the
  - Actions
  - IndexingRules
  - POIDisputes
  - allocation_receipts
  - vouchers
  - transfer_receipts
  - transfers
  - allocation_summaries
- The Agent can now be configured for multiple protocol networks.
  To enable this feature, start the agent with the environment variable `INDEXER_AGENT_MULTINETWORK_MODE` set to
  `true` and specify a directory containing YAML network specification files, one per network.
- The Agent can be configured to automatically support subgraph transfers from L1 to L2. To enable
  this feature, set the `enable-auto-migration-support` startup option to `true`.

### Changed
- The Agent GraphQL API was updated to accept (and in some cases require) a `protocolNetwork`
  parameter to determine which network should be used for queries or mutations.
- The `/network` endpoint exposed by the Agent now requires an additional path segment to disambiguate
  which protocol network it should target, like `/network/mainnet` or `/network/arbitrum-one`.

## [0.20.17] - 2023-06-19
### Changed
- Use updated batch stake feasibility check, improve potential action batch efficiency

## [0.20.12] - 2023-02-19
### Changed
- Only require network current epoch resolutio if indexing a subgraph on network chain

## [0.20.11] - 2023-02-01
### Changed
- Remove unnecessary currentEpochStartBlock eventual

## [0.20.9] - 2023-01-24
### Changed
- The `--epoch-subgraph-endpoint` is now a required parameter to start the Agent

## [0.20.7] - 2022-12-20
### Changed
- Agent makes deployment assignment decisions

## [0.20.6] - 2022-12-14
### Removed
- The `ethereum-network` command line argument is no longer required

### Changed
- Leave subgraph node assignment decisions to the graph nodes (user can control using graph-node.toml)
- Upgrade @graphprotocol/common-ts to v2.0.1

## [0.20.4] - 2022-09-29
### Added
- Use partial-vouchers endpoint to batch receipt collection
- Integrate epochSubgraph, use for multi-chain POI resolve

### Changed
- Remove cost model default file in favor or applying via cli

## [0.20.3] - 2022-08-31
### Added
- Include rule match crieteria as action reason to improve debugging process

## [0.20.2] - 2022-08-09
### Added
- Migration: update Actions.failureReason column size

## [0.20.1] - 2022-08-04
### Added
- Provide allocation action batching controls
- Option to set a global default cost model

### Changed
- Support Goerli network (upgrade @graphprotocol/contracts)

## [0.20.0] - 2022-06-21
### Added
- Support file-based configuration of startup params
- New allocation management mode, oversight, for requiring indexer approval to execute agents actions

### Changed
- Agent now pushes proposed allocation changes to action queue for execution by worker instead of executing them from the agent

## [0.19.3] - 2022-06-14
### Changed
- Move Network module to indexer-common

### Added
- Manual management mode

## [0.19.1] - 2022-04-21
### Changed
- Upgrade dependencies

### Added
- Assign deployments to nodes based on usage
- Check previous allocation closed w/ valid POI before creating

## [0.19.0] - 2022-02-24
### Added
- Added automatic batching of query voucher redemptions
- Added `--voucher-redemption-threshold`, `--voucher-redemption-batch-threshold` and `--voucher-redemption-max-batch-size` for controlling voucher batching behaviour
- Expose option to allocate to network subgraph
- Live metric for operator ETH balance
- DB migration CLI tool for testing and management of migrations
- Support indexer rules defined by subgraph id
- Support offchain subgraph management via indexing rules / CLI
- Agent immediately reconciles after rule update
- Manage allocation lifetimes via rules/CLI
- Reject unsupported subgraphs by default
- Optional autorenewal of allocations

### Fixed
- Added `--rebate-claim-max-batch-size` to make max batch size configurable. For users in low-RAM environments, the primary constraint is not block space but the RAM required to construct large transactions.
- Improved validation of rebate batch claim parameters

### Changed
- Upgrade dependencies
- Improve log messages readability
- Use signallTokens instead of signalAmount for minSignal threshold
- Use AllocationExchange contract from common-ts

## [0.18.6] - 2021-12-23
### Fixed
- Fix subgraphDeploymentsWorthIndexing batch query mangagement

## [0.18.4] - 2021-12-09
### Added
- Max claim batch size parameter

### Fixed
- Fix logic to ensure network subgraph not allocated towards

## [0.18.3] - 2021-11-23
### Fixed
- Only add prefix to voucher address if not present
- Bump type 2 transaction gas fee configs on retry after timeout

### Changed
- Keep deployment indexing for 1 day after allocation close
- Reducing transaction logging redundancy to improve readability

## [0.18.2] - 2021-10-19
### Changed
- Bump priority gas fee on gas price too low retry

### Fixed
- Set default parallelAllocations = 1

## [0.18.0] - 2021-09-07
### Added
- Support type 0x2 transactions (EIP-1559)
- Close all parallel allocations and only renew a single allocation per deployment
- Include an additional state for indexing dispute monitoring, references_unavailable, for the case where the indexer does not have a reference PoI available. Typically this case occurs when an indexer's deployment is not synced far enough

### Changed
- Update Ethers dependencies
- Simplify transaction retry logic on nonce collisions; agent now introduces a delay and returns to reconciliation step to re-evaluate
- Deprecate the parallel allocations feature

### Fixed
- Update max-transaction-attempts default to unlimited to avoid orphaned transactions
- Treat deployments assigned to node = null or undefined as removed, so they are filtered out of the activeDeployments array
- Fix delete query fee vouchers logic, so they are actually removed after the expiration time
- Update tests to use the latest version of the Indexer class constructor

## [0.17.0] - 2021-07-21
### Added
- Reallocate to subgraph deployment in one transaction using closeAndAllocate
- Wait for gas prices below the `gas-price-max` (gwei) before proceeding with transaction execution

### Changed
- Show subgraph query error reason in logs
- Use `ClusterIP` in the k8s indexer agent service rather than a `LoadBalalancer` since `LoadBalancer` services have been
  shown to introduce extra latency
- Use undefined for auth user and password if none specified
- Update `gas-price-max` units to be gwei instead of wei for improved human readability
- Default `gas-price-max` changed from 20 gwei to 50 gwei

### Fixed
- Improve robustness of subgraph deployments query by querying batches of only 10 deployments at a time

## [0.16.0] - 2021-06-09
### Changed
- Default to only one transaction retry attempt to reduce gas usage
- Apply allocation claim threshold to redeeming query fee vouchers as well
- Add the same network subgraph fallback logic as the agent uses

### Fixed
- Improve handling of reverted transactions by detecting the revert reason

## [0.15.1] - 2021-05-26
### Fixed
- Ensure allocation summaries exist for allocations created before v0.15.0 or outside the indexer agent

## [0.15.0] - 2021-05-25
### Fixed
- Make receipts table renaming migration more robust

### Added
- Allow network subgraph endpoint to be used as a fallback for the local network subgraph deployment
- Add allocation exchange contract address for mainnet

### Changed
- Rename query fee related fields in database models

## [0.14.0] - 2021-05-12
### Added
- Store allocations for which the POI has been checked
- Add subgraph deployment ID to POI disputes
- Add allocation-based receipts and query fee vouchers as an alternative to Vector. This is the default for now. Vector support can still be enabled with `--use-vector`.

### Fixed
- Handle 'nonce has already been used' transaction failures

## [0.13.0] - 2021-04-19
### Changed
- Update to latest common-ts

### Fixed
- Correctly determine the previous epoch when generating POIs

## [0.12.0] - 2021-04-06
### Changed
- Update common-ts and ethers

## [0.11.0] - 2021-03-31
### Added
- Add `--offchain-subgraphs` to index subgraph deployments that are not on chain
- Add `--poi-monitoring` (experimental) to monitor and cross-check POIs submitted in the network
- Add support for new payments system
- Add database migration to remove old state channel tables
- Resubmit transactions with higher gas price if they are not mined

### Changed
- Update @graphprotocol/common-ts to 1.3.2 (equality fix in eventuals, latest contracts)

## [0.10.0] - 2021-01-29
### Changed
- Update common-ts to 1.3.0 to include new testnet contracts

## [0.9.5] - 2021-01-16
### Fixed
- Update ethers to 5.0.26 to avoid unresolved promise rejections (#183)

### Changed
- Update common-ts to 1.2.1

## [0.9.4] - 2021-01-13
### Fixed
- Never close allocations if the POI is zero or null (#186)
- Retry obtaining a POI ten times before giving up

## [0.9.3] - 2021-01-11
### Fixed
- Fix how query fee threshold is passed to claimable allocations query

## [0.9.2] - 2021-01-09
### Added
- Add `--allocation-claim-threshold` option for configure a GRT amount below which the agent should not attempt to claim rebate (query) rewards

### Fixed
- Synchronize data independently using different intervals and reconcile reliably every 2 minutes
- Submit proof of indexing for the first block of the current epoch
- Reliably obtain proof of indexing by passing block number to `proofOfIndexing` API (#186)

### Changed
- Update common-ts to 1.2.0

## [0.9.1] - 2020-12-31
### Changed
- Register after having the network subgraph synced

## [0.9.0-alpha.4] - 2020-12-20
### Fixed
- Fix race condition between registering and pause/operator detection (#167)

## [0.9.0-alpha.3] - 2020-12-19
### Fixed
- Use 1.5x the estimated gas to avoid transactions running out of gas

### Changed
- Default to mainnet instead of rinkeby in `--ethereum-network`

### Added
- Add `--dai-contract` / `INDEXER_AGENT_DAI_CONTRACT` to set the stablecoint for `--inject-dai`

## [0.4.5] - 2020-12-15
### Fixed
- Retry network synchronization (#146)
- Index but don't allocate towards network subgraph

## [0.4.4] - 2020-12-14
### Fixed
- Allow non-HTTPS/insuecure Ethereum connections
- Catch and log unhandled promise rejections and exceptions instead of crashing

### Added
- Allow Ethereum network to be configured, avoiding fallible network detection in ethers.js

## [0.4.3] - 2020-12-07
### Fixed
- Fix incorrect error code used in database migrations
- Decouple claiming rewards from updating allocations
- Don't abort reconciling if removing a deployment fails
- Never fail reconciling early
- Fix zero allocation amount log messages
- Catch more unauthorized transactions
- Only queue transactions after checking paused and operator status
- Do nothing if not an operator
- Fix indexer === operator detection
- Use StaticJsonRpcProvider to reduce Ethereum requests

### Changed
- Lengthen network synchronization interval to 120s
- Improve log message for already closed allocations
- Add `eth_provider_requests` metric to track Ethereum requests

## [0.4.2] - 2020-11-30
### Fixed
- Fix signing allocation ID proofs with the corresponding private key

## [0.4.1] - 2020-11-27
### Fixed
- Fix GDAI token address

## [0.4.0] - 2020-11-27
### Added
- Add migration to reset state channels

### Changed
- Update common-ts to 0.4.0

## [0.3.7-alpha.8] - 2020-11-27
### Added
- Make use of the new indexer error codes

## [0.3.7-alpha.7] - 2020-11-27
### Changed
- Increase network synchronization intervals

## [0.3.7-alpha.0] - 2020-11-17
### Added
- Add `--restake-rewards` option for choosing what to do with indexing rewards

### Changed
- Update `@graphprotocol/common-ts` to 0.3.13

## [0.3.6] - 2020-11-11
### Changed
- Document that --index-node-ids are comma-separated
- Update network subgraph deployment

### Fixed
- Fix caching of indexing status queries
- Fix submitting a non-zero PoI on incompatible networks

## [0.3.4] - 2020-10-29
### Changed
- Update and pin all dependencies

## [0.3.3] - 2020-10-28
### Fixed
- Fix not creating any allocations at all anymore

### Added
- Add database migrations

### Changed
- Rename `$DAI` injection flag to `--inject-dai`

## [0.3.2] - 2020-10-27
### Added
- Don't try to allocate zero or negative GRT amounts
- Submit random POI, if cannot create one, to allow testing of indexer rewards distribution on testnet
- Add optional GDAI/GRT variable automation
- Include metrics for the GRT<->DAI conversion rate in both directions

### Fixed
- Reduce failed allocate txs by improving allocation id collision resistence
- Increase effective allocations limit (100 -> 1000)
- Validate allocation ID with contract before sending an allocate() tx

## [0.3.1] - 2020-10-15
### Changed
- Update common-ts to 0.3.3

## [0.3.0] - 2020-10-13
### Fixed
- Fix ethers incompatibilities
- Avoid closing allocations repeatedly
- Fix `INDEXER_AGENT_INDEXER_GEO_COORDINATES` environment variable (#58)

### Changed
- Implement reconciliation loop using eventuals
- Improve synchronization comments
- Update common-ts to 0.3.2
- Update contracts to 0.7.5-testnet-phase2
- Add full support for managing allocations as an operator
- Generate unique but deterministic allocation IDs

### Added
- Handle network pausing
- Submit POI when closing allocations
- Claim rebate rewards for finalized allocations
- Log contract addresses when connecting to the network
- Add --indexer-address to declare which indexer is being operated for

### Removed
- Remove staking (indexers need to do it, operators cannot)

## [0.2.6] - 2020-10-13
### Fixed
- Avoid settling allocations that are already settled on chain
- Fix input validation of geo coordinates

### Changed
- Use new indexer-common library
- Update common-ts, server-wallet and ethers

## [0.2.5] - 2020-09-01
### Changed
- Depend on @graphprotocol/common-ts from npmjs.org

## [0.2.4] - 2020-09-01
### Added
- Support `--graph-node-admin-endpoint` over HTTPS
- Terraform: Allow to configure preemptible worker nodes

### Fixed
- Settle allocations only after at least one epoch has passed

### Changed
- Reconcile deployments and allocations every ~10+ seconds
- Show and use correct token/allocation amounts everywhere
- Update @graphprotocol/common-ts to 0.2.4

## [0.2.3] - 2020-08-27
### Fixed
- Re-register indexer when geohash differs

### Changed
- Update @graphprotocol/common-ts to 0.2.3

## 0.2.1 - 2020-08-27
### Fixed
- Indexer agent fails to detect GRT approval

### Changed
- Update @graphprotocol/common-ts to 0.2.2

[Unreleased]: https://github.com/graphprotocol/indexer/compare/v0.20.23-rc.0...HEAD
[0.20.23]: https://github.com/graphprotocol/indexer/compare/v0.20.22...v0.20.23
[0.20.22]: https://github.com/graphprotocol/indexer/compare/v0.20.21...v0.20.22
[0.20.21]: https://github.com/graphprotocol/indexer/compare/v0.20.20...v0.20.21
[0.20.20]: https://github.com/graphprotocol/indexer/compare/v0.20.19...v0.20.20
[0.20.19]: https://github.com/graphprotocol/indexer/compare/v0.20.18...v0.20.19
[0.20.18]: https://github.com/graphprotocol/indexer/compare/v0.20.17...v0.20.18
[0.20.17]: https://github.com/graphprotocol/indexer/compare/v0.20.12...v0.20.17
[0.20.12]: https://github.com/graphprotocol/indexer/compare/v0.20.11...v0.20.12
[0.20.11]: https://github.com/graphprotocol/indexer/compare/v0.20.9...v0.20.11
[0.20.9]: https://github.com/graphprotocol/indexer/compare/v0.20.7...v0.20.9
[0.20.7]: https://github.com/graphprotocol/indexer/compare/v0.20.6...v0.20.7
[0.20.6]: https://github.com/graphprotocol/indexer/compare/v0.20.4...v0.20.6
[0.20.4]: https://github.com/graphprotocol/indexer/compare/v0.20.3...v0.20.4
[0.20.3]: https://github.com/graphprotocol/indexer/compare/v0.20.2...v0.20.3
[0.20.2]: https://github.com/graphprotocol/indexer/compare/v0.20.1...v0.20.2
[0.20.1]: https://github.com/graphprotocol/indexer/compare/v0.20.0...v0.20.1
[0.20.0]: https://github.com/graphprotocol/indexer/compare/v0.19.3...v0.20.0
[0.19.3]: https://github.com/graphprotocol/indexer/compare/v0.19.1...v0.19.3
[0.19.1]: https://github.com/graphprotocol/indexer/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/graphprotocol/indexer/compare/v0.18.6...v0.19.0
[0.18.6]: https://github.com/graphprotocol/indexer/compare/v0.18.4...v0.18.6
[0.18.4]: https://github.com/graphprotocol/indexer/compare/v0.18.3...v0.18.4
[0.18.3]: https://github.com/graphprotocol/indexer/compare/v0.18.2...v0.18.3
[0.18.2]: https://github.com/graphprotocol/indexer/compare/v0.18.0...v0.18.2
[0.18.0]: https://github.com/graphprotocol/indexer/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/graphprotocol/indexer/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/graphprotocol/indexer/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/graphprotocol/indexer/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/graphprotocol/indexer/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/graphprotocol/indexer/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/graphprotocol/indexer/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/graphprotocol/indexer/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/graphprotocol/indexer/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/graphprotocol/indexer/compare/v0.9.5...v0.10.0
[0.9.5]: https://github.com/graphprotocol/indexer/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/graphprotocol/indexer/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/graphprotocol/indexer/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/graphprotocol/indexer/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/graphprotocol/indexer/compare/v0.9.0-alpha.4...v0.9.1
[0.9.0-alpha.4]: https://github.com/graphprotocol/indexer/compare/v0.9.0-alpha.3...v0.9.0-alpha.4
[0.9.0-alpha.3]: https://github.com/graphprotocol/indexer/compare/v0.4.5...v0.9.0-alpha.3
[0.4.5]: https://github.com/graphprotocol/indexer/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/graphprotocol/indexer/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/graphprotocol/indexer/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/graphprotocol/indexer/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/graphprotocol/indexer/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.8...v0.4.0
[0.3.7-alpha.8]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.7...v0.3.7-alpha.8
[0.3.7-alpha.7]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.0...v0.3.7-alpha.7
[0.3.7-alpha.0]: https://github.com/graphprotocol/indexer/compare/v0.3.6...v0.3.7-alpha.0
[0.3.6]: https://github.com/graphprotocol/indexer/compare/v0.3.4...v0.3.6
[0.3.4]: https://github.com/graphprotocol/indexer/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/graphprotocol/indexer/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/graphprotocol/indexer/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/graphprotocol/indexer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/graphprotocol/indexer/compare/v0.2.6...v0.3.0
[0.2.6]: https://github.com/graphprotocol/indexer/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/graphprotocol/indexer/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/graphprotocol/indexer/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/graphprotocol/indexer/compare/v0.2.1...v0.2.3
