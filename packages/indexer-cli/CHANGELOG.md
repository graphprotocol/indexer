# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.19.1] - 2022-04-21
### Added
- Include tests of cost commands

### Changed
- Upgrade dependencies

## [0.19.0] - 2022-02-24
### Changed
- Upgrade dependencies

### Added
- Reusable CLI test harness
- CLI tests for all rules commands
- Support indexer rules defined by subgraph id
- Support offchain subgraph management via indexing rules / CLI
- Manage allocation lifetimes via rules/CLI
- Support rejecting unsupported subgraphs
- Optional autorenewal of allocations

## 0.18.6 - 2022-01-05

## [0.18.0] - 2021-09-07
### Changed
- Update Ethers dependencies

### Added
- Show the status of indexer's active allocations in `status` command output
- Show the status of indexer's subgraph deployments in `status` command output

## [0.17.0] - 2021-07-21
### Fixed
- Remove vestigial check for `channel-messages-inbox` endpoint

## [0.15.0] - 2021-05-25
### Changed
- Rename query fee related fields in database models

## [0.14.0] - 2021-05-12
### Added
- Add subgraph deployment ID to POI disputes

## [0.13.0] - 2021-04-19
### Changed
- Update to latest common-ts

## [0.12.0] - 2021-04-06
### Changed
- Update common-ts and ethers

## [0.11.0] - 2021-03-31
### Added
- Add `graph indexer disputes get` command to list potentially disputable POIs in the network.

### Changed
- Update @graphprotocol/common-ts to 1.3.2

## [0.10.0] - 2021-01-29
### Changed
- Update common-ts to 1.3.0 to include new testnet contracts

## [0.9.5] - 2021-01-16
### Fixed
- Update ethers to 5.0.26 to avoid unresolved promise rejections (#183)

### Changed
- Update common-ts to 1.2.1

## [0.9.4] - 2021-01-13
### Changed
- No changes

## [0.9.3] - 2021-01-11
### Changed
- No changes

## [0.9.2] - 2021-01-09
### Changed
- Update common-ts to 1.2.0

## [0.4.0] - 2020-11-27
### Changed
- Update common-ts to 0.4.0

## [0.3.7-alpha.0] - 2020-11-17
### Changed
- Update `@graphprotocol/common-ts` to 0.3.13

## [0.3.4] - 2020-10-29
### Changed
- Update and pin all dependencies

## [0.3.2] - 2020-10-27
### Added
- Add 'graph indexer rules delete \<all | global | deployment-id>' command

## [0.3.1] - 2020-10-15
### Changed
- Update common-ts to 0.3.3

## [0.3.0] - 2020-10-13
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

[Unreleased]: https://github.com/graphprotocol/indexer/compare/v0.19.1...HEAD
[0.19.1]: https://github.com/graphprotocol/indexer/compare/v0.19.0...v0.19.1
[0.19.0]: https://github.com/graphprotocol/indexer/compare/v0.18.6...v0.19.0
[0.18.0]: https://github.com/graphprotocol/indexer/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/graphprotocol/indexer/compare/v0.15.0...v0.17.0
[0.15.0]: https://github.com/graphprotocol/indexer/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/graphprotocol/indexer/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/graphprotocol/indexer/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/graphprotocol/indexer/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/graphprotocol/indexer/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/graphprotocol/indexer/compare/v0.9.5...v0.10.0
[0.9.5]: https://github.com/graphprotocol/indexer/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/graphprotocol/indexer/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/graphprotocol/indexer/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/graphprotocol/indexer/compare/v0.4.0...v0.9.2
[0.4.0]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.0...v0.4.0
[0.3.7-alpha.0]: https://github.com/graphprotocol/indexer/compare/v0.3.4...v0.3.7-alpha.0
[0.3.4]: https://github.com/graphprotocol/indexer/compare/v0.3.2...v0.3.4
[0.3.2]: https://github.com/graphprotocol/indexer/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/graphprotocol/indexer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/graphprotocol/indexer/compare/v0.2.6...v0.3.0
[0.2.6]: https://github.com/graphprotocol/indexer/compare/v0.1.4...v0.2.6
[0.1.4]: https://github.com/graphprotocol/cli/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/graphprotocol/cli/compare/v0.1.1...v0.1.3
