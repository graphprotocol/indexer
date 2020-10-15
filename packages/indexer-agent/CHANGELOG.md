# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/graphprotocol/indexer/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/graphprotocol/indexer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/graphprotocol/indexer/compare/v0.2.6...v0.3.0
[0.2.6]: https://github.com/graphprotocol/indexer/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/graphprotocol/indexer/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/graphprotocol/indexer/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/graphprotocol/indexer/compare/v0.2.1...v0.2.3
