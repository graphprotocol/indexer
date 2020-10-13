# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Changed
- Skip the scrypt dependency
- Update common-ts to 0.3.2
- Properly support 0x- and Qm-style deployment IDs
- Format cost model variables with indentation
- Read cost models from input files instead of CLI args
- Display decisionBasis field in `graph indexer status` output

### Added
- Allow to clear/reset all fields of a rule at once (#42)
- Add `graph indexer cost` subcommands

## [0.2.6] - 2020-10-13
### Changed
- Update to indexer-common

## [0.1.4] - 2020-09-01
### Changed
- Make indexing rules and status commands more robust
- Update @graphprotocol/common-ts to 0.2.4

## [0.1.3] - 2020-08-27
### Fixed
- Always refer to `graph indexer`, not `graph indexing`

### Changed
- Update @graphprotocol/common-ts to 0.2.3

### Added
- Detailed endpoint statuses and possible actions in `graph indexer status`

## 0.1.1 - 2020-08-27
### Fixed
- Detect indexer registration correctly

### Changed
- Update @graphprotocol/common-ts to 0.2.2

[Unreleased]: https://github.com/graphprotocol/indexer/compare/v0.2.6...HEAD
[0.2.6]: https://github.com/graphprotocol/indexer/compare/v0.1.4...v0.2.6
[0.1.4]: https://github.com/graphprotocol/cli/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/graphprotocol/cli/compare/v0.1.1...v0.1.3
