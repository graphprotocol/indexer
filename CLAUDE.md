# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is the Graph Protocol Indexer monorepo containing the indexer agent, CLI, and common libraries. The indexer helps run infrastructure for The Graph Network by indexing subgraphs and serving queries.

## Repository Structure

- **`/packages/`** - Lerna monorepo with 3 active packages:
  - **`indexer-agent/`** - Main indexer agent that manages allocations and monitors the network
  - **`indexer-cli/`** - CLI for managing indexer operations (plugin for @graphprotocol/graph-cli)
  - **`indexer-common/`** - Shared functionality used by other packages
- **`/docs/`** - Documentation including network configs and setup guides
- **`/k8s/`** - Kubernetes deployment configurations
- **`/terraform/`** - Infrastructure as Code for GKE deployment
- **`/scripts/`** - Utility scripts including test runner

## Essential Commands

### Development Setup
```bash
# Install dependencies and build all packages
yarn
yarn bootstrap

# Clean and rebuild everything
yarn clean && yarn bootstrap

# Compile TypeScript across all packages
yarn compile
```

### Running Tests
```bash
# Run all tests (requires PostgreSQL container - use the script below)
bash scripts/run-tests.sh

# Run tests in a specific package
cd packages/indexer-agent && yarn test
cd packages/indexer-cli && yarn test
cd packages/indexer-common && yarn test

# Run a specific test file
yarn test path/to/specific.test.ts

# Run tests matching a pattern
yarn test --testNamePattern="specific test name"

# Watch mode for TDD
yarn test:watch

# Debug mode with verbose logging
yarn test:debug
```

### Code Quality
```bash
# In any package directory
yarn format    # Format code with Prettier
yarn lint      # Lint and fix TypeScript files
yarn prepare   # Run format, lint, and compile
yarn clean     # Clean build artifacts and node_modules
```

### Running the Indexer
```bash
# From source (after building)
cd packages/indexer-agent
./bin/graph-indexer-agent start [options]

# CLI commands
graph indexer [command]
```

## Architecture

### Core Components
1. **Indexer Agent** - Autonomous agent that:
   - Monitors the network for subgraph deployments
   - Manages allocations (stake on subgraphs)
   - Handles query fee collection via TAP (Timeline Aggregation Protocol)
   - Submits POIs (Proofs of Indexing)
   - Manages interactions with Graph Node

2. **Indexer CLI** - Management interface for:
   - Setting indexing rules
   - Managing allocations manually
   - Configuring cost models
   - Monitoring disputes
   - Managing action queue

3. **Indexer Common** - Shared libraries for:
   - Database models (Sequelize ORM)
   - Ethereum interactions
   - Network subgraph queries
   - Common types and utilities

### Key Technical Details
- **Language**: TypeScript with strict type checking
- **Database**: PostgreSQL (via Sequelize ORM)
- **Blockchain**: Ethereum/Arbitrum (via ethers.js)
- **Testing**: Jest with ts-jest
- **Monorepo**: Lerna with Yarn workspaces

### Database Schema
The indexer uses PostgreSQL to store:
- Indexing rules
- Allocation management state
- Action queue
- Cost models
- POI dispute data
- TAP receipts and RAVs (Receipt Aggregate Vouchers)

Database migrations are managed via Umzug. Available migration commands in `indexer-agent`:
```bash
yarn migrator:pending   # View pending migrations
yarn migrator:executed  # View executed migrations
yarn migrator:up        # Run pending migrations
yarn migrator:down      # Rollback last migration
```

### Integration Points
- **Graph Node**: Queries subgraph data and manages deployments
- **Ethereum/Arbitrum**: On-chain transactions for allocations
- **Network Subgraph**: Queries protocol state
- **TAP (Timeline Aggregation Protocol)**: Handles query fee collection and redemption
- **TAP Subgraph**: Tracks TAP receipts and RAVs

## Testing Requirements

Tests require:
1. Docker installed and running
2. PostgreSQL database (handled by `scripts/run-tests.sh`)
3. Environment variables in `.env` (copy from `.env.example`):
   ```
   INDEXER_TEST_JRPC_PROVIDER_URL=<Arbitrum Sepolia RPC>
   INDEXER_TEST_API_KEY=<Graph API key>
   ```

The `scripts/run-tests.sh` script:
- Starts a PostgreSQL container with test configuration
- Loads credentials from `.env`
- Runs the test suite with proper environment variables
- Cleans up the PostgreSQL container when done

## Horizon Support

The indexer now supports Graph Horizon, the next-generation architecture for The Graph Protocol:

### Key Changes
- **Dual Contract System**: Supports both legacy and Horizon contracts simultaneously
- **New Contracts**: HorizonStaking, SubgraphService, PaymentsEscrow, GraphTallyCollector
- **Enhanced TAP v2**: Receipt Aggregate Vouchers v2 (RAV v2) with collection-based aggregation
- **Automatic Detection**: System automatically detects Horizon-enabled networks
- **Address Books**: Separate configuration for horizon, subgraph-service, and TAP contracts

### Configuration
```bash
# New Horizon-specific options
--horizon-address-book           # Path to Horizon contracts address book
--subgraph-service-address-book  # Path to SubgraphService contracts address book
--tap-address-book               # Path to TAP contracts address book
--max-provision-initial-size    # Initial SubgraphService provision size
--payments-destination           # Separate payment collection address
```

### Database Migrations
- Migration 21: Adds TAP Horizon tables for receipts and RAVs
- Migration 22: Adds TAP Horizon deny list functionality

## Package Architecture

### indexer-common
Core shared library providing:
- **Allocations**: Horizon and legacy allocation management (`allocations/`)
  - TAP collector for query fee collection
  - Graph tally collector for aggregating receipts
  - Escrow account management for both Horizon and legacy
- **Indexer Management**: GraphQL server and resolvers for managing indexer operations
  - Action queue management
  - Allocation lifecycle
  - Indexing rules
  - Cost models
- **Network**: Network subgraph queries and protocol interactions
- **Graph Node**: Graph Node status and deployment management APIs
- **Subgraphs**: Subgraph deployment utilities and helpers
- **Transactions**: Ethereum transaction management with gas optimization

### indexer-agent
Autonomous agent that:
- Monitors network for subgraph deployments via network subgraph
- Manages allocations based on indexing rules (automatic or manual mode)
- Collects query fees via TAP protocol
- Submits POIs (Proofs of Indexing) on-chain
- Handles disputes monitoring
- Manages Graph Node deployments

### indexer-cli
Command-line interface providing commands for:
- Indexing rules management (`graph indexer rules`)
- Allocation management (`graph indexer allocations`)
- Action queue operations (`graph indexer actions`)
- Cost model configuration (`graph indexer cost`)
- Provision management for Horizon (`graph indexer provision`)
- Status monitoring (`graph indexer status`)
- Disputes monitoring (`graph indexer disputes`)

## Current State
- Version: v0.24.3
- Node version: >=18.0.0
- Main branch: main
- Package manager: Yarn 1.22.22
- Beta software status
- Horizon support: Active on supported networks