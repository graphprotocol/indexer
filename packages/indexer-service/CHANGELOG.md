# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## [0.9.1] - 2020-12-31
### Fixed
- Fix uncaught `holdings(bytes32)` exceptions by disabling the state channels `ChainService` for now

## [0.9.0-alpha.3] - 2020-12-19
### Changed
- Default to mainnet instead of rinkeby in `--ethereum-network`

### Fixed
- Fix `--ethereum-network` not being used

## [0.4.4] - 2020-12-14
### Fixed
- Allow non-HTTPS/insuecure Ethereum connections
- Catch and log unhandled promise rejections and exceptions instead of crashing

### Added
- Allow Ethereum network to be configured, avoiding fallible network detection in ethers.js

## [0.4.3] - 2020-12-07
### Fixed
- Use StaticJsonRpcProvider to reduce Ethereum requests

### Added
- Add `--log-level` / `INDEXER_SERVICE_LOG_LEVEL` option
- Add `--ethereum-polling-interval` / `INDEXER_SERVICE_ETHEREUM_POLLING_INTERVAL` option
- Add `eth_provider_requests` metric to track Ethereum requests

## [0.4.0] - 2020-11-27
### Added
- Add `--wallet-worker-threads` / `INDEXER_SERVICE_WALLET_WORKER_THREADS` to replace the old `AMOUNT_OF_WORKER_THREADS` environment variable
- Add `--wallet-skip-evm-validation` / `INDEXER_SERVICE_WALLET_SKIP_EVM_VALIDATION` to replace the `SKIP_EVM_VALIDATION` environment variable

### Changed
- Update common-ts to 0.4.0

## [0.3.7-alpha.8] - 2020-11-27
### Added
- Make use of the new indexer error codes

## [0.3.7-alpha.7] - 2020-11-27
### Fixed
- Fix caching of only a few attestation signers

### Changed
- Increase network synchronization intervals

## [0.3.7-alpha.6] - 2020-11-27
### Changed
- Update receipt manager and receipt manager construction

## [0.3.7-alpha.5] - 2020-11-27
### Fixed
- Fix how queries are declined

## [0.3.7-alpha.4] - 2020-11-27
### Fixed
- Fix detecting and reading `package.json` (really)

## [0.3.7-alpha.3] - 2020-11-27
### Fixed
- Fix detecting and reading `package.json`

## [0.3.7-alpha.2] - 2020-11-19
### Added
- Add `/version` endpoint

## [0.3.7-alpha.1] - 2020-11-17
### Changed
- Update `@graphprotocol/receipt-manager` to 0.5.1

## [0.3.7-alpha.0] - 2020-11-17
### Fixed
- Remove unnecessary (and duplicate) server wallet migration (the receipt manager does it for us) (#107)
- Fix typo (capital letter) in `indexer_service_channel_messages_ok` metric

### Changed
- Use IPFS deployment IDs in all metrics
- Update `@graphprotocol/common-ts` to 0.3.13
- Update receipt manager to latest canary release

## [0.3.6] - 2020-11-11
### Fixed
- Don\\'t cache network subgraph data
- Fix free query auth token detection

### Changed
- Update common-ts to 0.3.11
- Update receipt manager to 0.4.3
- Skip EVM validation in state channels (for now)
- Use --frozen-lockfile for Docker image

## [0.3.4] - 2020-10-29
### Changed
- Update and pin all dependencies

## [0.3.3] - 2020-10-28
### Added
- Add `--metrics-port` / `INDEXER_SERVICE_METRICS_PORT`

## [0.3.2] - 2020-10-27
### Fixed
- Avoid GraphQL caching

## [0.3.1] - 2020-10-15
### Changed
- Update common-ts to 0.3.3

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

[Unreleased]: https://github.com/graphprotocol/indexer/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/graphprotocol/indexer/compare/v0.9.5...v0.10.0
[0.9.5]: https://github.com/graphprotocol/indexer/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/graphprotocol/indexer/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/graphprotocol/indexer/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/graphprotocol/indexer/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/graphprotocol/indexer/compare/v0.9.0-alpha.3...v0.9.1
[0.9.0-alpha.3]: https://github.com/graphprotocol/indexer/compare/v0.4.4...v0.9.0-alpha.3
[0.4.4]: https://github.com/graphprotocol/indexer/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/graphprotocol/indexer/compare/v0.4.0...v0.4.3
[0.4.0]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.8...v0.4.0
[0.3.7-alpha.8]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.7...v0.3.7-alpha.8
[0.3.7-alpha.7]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.6...v0.3.7-alpha.7
[0.3.7-alpha.6]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.5...v0.3.7-alpha.6
[0.3.7-alpha.5]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.4...v0.3.7-alpha.5
[0.3.7-alpha.4]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.3...v0.3.7-alpha.4
[0.3.7-alpha.3]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.2...v0.3.7-alpha.3
[0.3.7-alpha.2]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.1...v0.3.7-alpha.2
[0.3.7-alpha.1]: https://github.com/graphprotocol/indexer/compare/v0.3.7-alpha.0...v0.3.7-alpha.1
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
