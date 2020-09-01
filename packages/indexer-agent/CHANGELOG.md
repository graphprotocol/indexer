# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/graphprotocol/indexer/compare/v0.2.4...HEAD
[0.2.4]: https://github.com/graphprotocol/indexer/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/graphprotocol/indexer/compare/v0.2.1...v0.2.3
