# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
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
- Include metrics for the GRT&lt;->DAI conversion rate in both directions

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

[Unreleased]: https://github.com/graphprotocol/indexer/compare/v0.9.3...HEAD
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
