# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2020-10-13
### Changed
- Move receipt manager into an external package
- Increase `/channel-messages-inbox` request size limit
- Sign attestations with allocation-specific keys
- Add --indexer-address for allocation monitoring
- Update to the latest network subgraph

### Added
- Add /cost API
- Add server, channel message and cost API metrics

### Fixed
- Never cache active allocation query results

## [0.2.6] - 2020-10-13
### Added
- Add receipt manager for managing channels and payments

## [0.2.5] - 2020-09-01
### Changed
- Depend on @graphprotocol/common-ts from npmjs.org

## [0.2.4] - 2020-09-01
### Changed
- Update @graphprotocol/common-ts to 0.2.4

## [0.2.3] - 2020-08-27
### Changed
- Update @graphprotocol/common-ts to 0.2.3

## 0.2.1 - 2020-08-27
### Changed
- Update @graphprotocol/common-ts to 0.2.2

[Unreleased]: https://github.com/graphprotocol/indexer/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/graphprotocol/indexer/compare/v0.2.6...v0.3.0
[0.2.6]: https://github.com/graphprotocol/indexer/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/graphprotocol/indexer/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/graphprotocol/indexer/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/graphprotocol/indexer/compare/v0.2.1...v0.2.3
