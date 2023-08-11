# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.20.18] - 2023-08-11
### Added
- The `Network` type now holds references to all network-specific components, such as the `NetworkMonitor` and `Contracts` classes.
- Introduced `GraphNode` class to replace `Indexer`, `Subgraph`, and `IndexingStatus` classes.
- New general purpose `parser` module, used for input validation.
- New `NetworkSpecification` type, which holds all information required to represent a protocol network.

### Changed
- Added `protocolNetwork` field to most types.

## [0.20.17] - 2023-06-19
### Changed
- Check action batch feasibility at batch level only, improve batche efficiency
- Improved logging detail when queueing allocation receipts for collecting
- Update network alias value, polygon -> matic
- Update partial-vouchers encoding scheme

## [0.20.12] - 2023-02-19
### Added
- New `ReceiptMetrics` metric for allocation receipt collector
- Add `safety` option in indexing rules to not allocate to a deployment when its previous allocation was closed with a 0x0 POI

### Fixed
- Fix unresolved promise warning in monitor network pause function

### Changed
- Improve EBO missing data error log messages

## [0.20.11] - 2023-02-01
### Changed
- Use configured Ethereum provider for resolving protocol chain blocks (instead of graph-node)

### Fixed
- Use parseGRT in resolveActionsDelta to parse to BigNumber

## [0.20.10] - 2023-01-31
### Added
- Moved GRT stake feasibility check from the action level to batch level

## [0.20.9] - 2023-01-24
### Changed
- Epoch block tracking is now handled by the Epoch Subgraph instead of the Epoch Manager contract
- Add CAIP-2 id map entries for: hardhat, polygon, optimism, celo, avalanche, arbitrum and arbitrum-goerli

## [0.20.8] - 2022-12-21
### Fixed
- Use network alias when querying blockHashFromNumber

### Added
- Add tests for CAIP id conversion functions

## [0.20.7] - 2022-12-20
### Changed
- Use strict chain identifier check on \`resolveChainId()

## [0.20.6] - 2022-12-14
### Changed
- The `ethereum-network` is now inferred from provider's `chainId`
- Retry epoch subgraph queries
- Avoid requeueing recently failed actions
- Avoid querying block information when action is forced and poi is provided
- Avoid requeueuing recently successful actions
- Add retry loop around epoch subgraph queries
- Upgrade @graphprotocol/common-ts to v2.0.1

### Fixed
- Allow null IndexerDeployment.node in status responses

## [0.20.4] - 2022-09-29
### Fixed
- Fix signal threshold check bug in isDeploymentWorthAllocatingTowards()

### Changed
- Remove max signal check, towards deprecating maxSignal

## [0.20.3] - 2022-08-31
### Changed
- Shorten failure reason: use indexer error codes

### Added
- Track rule matching criteria per action, store in actions db
- Allow allocations with allocationAmount = 0

### Fixed
- Use correct allocation amount big number formatting during auto indexing rule creation
- Fix fallback to global cost model if specific cost model not set

## [0.20.1] - 2022-08-04
### Fixed
- Query fee runtime type check error

## [0.20.0] - 2022-06-21
### Added
- Action queue for managing allocations directly, batching into single tx, and providing support for 3rd party allocation decision tools

### Changed
- Reorganize indexer management server creating separate modules for: allocations, actions, network monitoring, and rules

## [0.19.3] - 2022-06-14
### Added
- Allocations mutations and queries to management server for direct management of allocations

### Changed
- Bump @graphprotocol/cost-model from 0.1.11 to 0.1.14

## [0.19.1] - 2022-04-21
### Fixed
- Allow null POI dispute reference proofs
- Use consistent rule identifier formatting

### Changed
- Upgrade dependencies

## [0.19.0] - 2022-02-24
### Changed
- Upgrade dependencies

### Added
- Live metric for operator ETH balance
- Support indexer rules defined by subgraph id
- Support offchain subgraph management via indexing rules / CLI
- Manage allocation lifetimes via rules/CLI
- Support rejecting unsupported subgraphs
- Optional autorenewal of allocations¡

## 0.18.6 - 2022-01-05

## [0.18.1] - 2021-09-08
### Changed
- Reinclude Connext vector packages to dependencies

## [0.18.0] - 2021-09-07
### Changed
- Update Ethers dependencies

## [0.17.0] - 2021-07-21
### Changed
- Optimize `/network` execution by switching to a simpler HTTP client (doesn't need to be GraphQL aware)

## [0.15.1] - 2021-05-26
### Added
- Add `ensureAllocationSummary` utility for agent and service to use to create allocation summaries for receipts

## [0.15.0] - 2021-05-25
### Fixed
- Fix bug that could cause `AsyncCache` to fail perpetually

## [0.14.0] - 2021-05-12
### Added
- Add subgraph deployment ID to POI disputes
- Add async cache from indexer-service
- Add database models for allocation-based receipts and query fee vouchers

## [0.13.0] - 2021-04-19
### Changed
- Update to latest common-ts

## [0.12.0] - 2021-04-06
### Changed
- Update common-ts, vector and ethers

## [0.11.0] - 2021-03-31
### Added
- Add POI disputes to the indexer management API
- Add support for new payments system
- Add error types for new payments system
- Add error types for POI disputes
- Add error types for transaction management

### Changed
- Update @graphprotocol/common-ts to 1.3.2 (equality check fix in eventuals, latest contracts)

## [0.10.0] - 2021-01-29
### Changed
- Update common-ts to 1.3.0 to include new testnet contracts

## [0.9.5] - 2021-01-16
### Fixed
- Update ethers to 5.0.26 to avoid unresolved promise rejections (#183)

### Changed
- Update common-ts to 1.2.1

### Added
- Validate cost models in `setCostModel` (#182)

## [0.9.4] - 2021-01-13
### Changed
- No changes

## [0.9.3] - 2021-01-11
### Changed
- No changes

## [0.9.2] - 2021-01-09
### Changed
- Update common-ts to 1.2.0

## [0.4.4] - 2020-12-14
### Added
- Add `IE035` and `IE036` error types for unhandled promises and exceptions

## [0.4.2] - 2020-11-30
### Changed
- Return an allocation signer from `uniqueAllocationId`

## [0.4.0] - 2020-11-27
### Changed
- Update common-ts to 0.4.0

## [0.3.7-alpha.8] - 2020-11-27
### Added
- Add standard indexer errors and `indexer_error` metric

## [0.3.7-alpha.0] - 2020-11-17
### Changed
- Update `@graphprotocol/common-ts` to 0.3.13

## [0.3.4] - 2020-10-29
### Changed
- Update and pin all dependencies

## [0.3.3] - 2020-10-28
### Fixed
- Preserve `$DAI` on updates
- Fix injecting `$DAI` into `null` variables
- Fix adding `$DAI` to `null` cost models in `setCostModel` mutation
- Don't accidentally clear non-`$DAI` variables

### Added
- Inject `$DAI` into new models when they are created

### Changed
- Change cost model variable columns in the database to JSONB

## [0.3.2] - 2020-10-27
### Added
- Add 'deleteIndexingRules' mutation

### Fixed
- Fix clearing of cost models

## [0.3.1] - 2020-10-15
### Changed
- Update common-ts to 0.3.3

## [0.3.0] - 2020-10-13
### Changed
- Update common-ts to 0.3.2

### Added
- Add cost model management with tests
- Add helpers for allocation IDs and attestation signer keys

## 0.2.6 - 2020-10-13
### Added
- Move indexing rule management here from `@graphprotocol/common-ts`

[Unreleased]: https://github.com/graphprotocol/indexer/compare/v0.20.18...HEAD
[0.20.18]: https://github.com/graphprotocol/indexer/compare/v0.20.17...v0.20.18
[0.20.17]: https://github.com/graphprotocol/indexer/compare/v0.20.12...v0.20.17
[0.20.12]: https://github.com/graphprotocol/indexer/compare/v0.20.11...v0.20.12
[0.20.11]: https://github.com/graphprotocol/indexer/compare/v0.20.10...v0.20.11
[0.20.10]: https://github.com/graphprotocol/indexer/compare/v0.20.9...v0.20.10
[0.20.9]: https://github.com/graphprotocol/indexer/compare/v0.20.8...v0.20.9
[0.20.8]: https://github.com/graphprotocol/indexer/compare/v0.20.7...v0.20.8
[0.20.7]: https://github.com/graphprotocol/indexer/compare/v0.20.6...v0.20.7
[0.20.6]: https://github.com/graphprotocol/indexer/compare/v0.20.4...v0.20.6
[0.20.4]: https://github.com/graphprotocol/indexer/compare/v0.20.3...v0.20.4
[0.20.3]: https://github.com/graphprotocol/indexer/compare/v0.20.1...v0.20.3
[0.20.1]: https://github.com/graphprotocol/indexer/compare/v0.20.0...v0.20.1
[0.20.0]: https://github.com/graphprotocol/indexer/compare/v0.19.3...v0.20.0
[0.19.3]: https://github.com/graphprotocol/indexer/compare/v0.19.1...v0.19.3
[0.19.1]: https://github.com/graphprotocol/indexer/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/graphprotocol/indexer/compare/v0.18.6...v0.19.0
[0.18.1]: https://github.com/graphprotocol/indexer/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/graphprotocol/indexer/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/graphprotocol/indexer/compare/v0.15.1...v0.17.0
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
[0.9.2]: https://github.com/graphprotocol/indexer/compare/v0.4.4...v0.9.2
[0.4.4]: https://github.com/graphprotocol/indexer/compare/v0.4.2...v0.4.4
[0.4.2]: https://github.com/graphprotocol/indexer/compare/v0.4.0...v0.4.2
[0.4.0]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.8...v0.4.0
[0.3.7-alpha.8]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.0...v0.3.7-alpha.8
[0.3.7-alpha.0]: https://github.com/graphprotocol/indexer/compare/v0.3.4...v0.3.7-alpha.0
[0.3.4]: https://github.com/graphprotocol/indexer/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/graphprotocol/indexer/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/graphprotocol/indexer/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/graphprotocol/indexer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/graphprotocol/indexer/compare/v0.2.6...v0.3.0
