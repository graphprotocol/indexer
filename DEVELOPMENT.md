# Development Guide

This document provides comprehensive guidance for local development, testing, and contributing to the Graph Protocol Indexer project.

## Local Development and Testing

The project includes a `Dockerfile.dev` for consistent local development and testing environments. This is particularly useful for testing performance improvements and ensuring compatibility across different systems.

### Prerequisites

- [Docker](https://docker.com/) installed (or [Podman](https://podman.io/) as an alternative)
- Git (for cloning the repository)
- At least 4GB of available RAM

### Building the Development Image

```bash
# Build the development image
docker build -f Dockerfile.dev -t indexer-dev:latest .

# Note: You can also use Podman as a drop-in replacement for Docker
# podman build -f Dockerfile.dev -t indexer-dev:latest .
```

### Testing Performance Improvements Locally

**Note**: All `docker` commands in this section can be used with Podman by simply replacing `docker` with `podman`.

1. **Mount your local project and run tests:**
```bash
# Test the complete build
docker run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer && yarn compile"

# Test individual packages
docker run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer/packages/indexer-common && yarn compile"
docker run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer/packages/indexer-agent && yarn compile"
docker run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer/packages/indexer-cli && yarn compile"
```

2. **Test the new CLI flag:**
```bash
# Verify the new flag is available
docker run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer/packages/indexer-agent && node bin/graph-indexer-agent start --help | grep -A 5 'indexer-min-stake-threshold'"
```

3. **Run TypeScript type checking:**
```bash
# Check specific files for type errors
docker run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer/packages/indexer-common && tsc --noEmit src/subgraphs.ts"
```

### Interactive Development

**Note**: All `docker` commands in this section can be used with Podman by simply replacing `docker` with `podman`.

```bash
# Start an interactive shell in the container
docker run --rm -it -v $(pwd):/opt/indexer indexer-dev:latest bash

# Inside the container, you can:
cd /opt/indexer
yarn install          # Install dependencies
yarn compile         # Build all packages
yarn test           # Run tests
```

### Environment Variables for Testing

**Note**: All `docker` commands in this section can be used with Podman by simply replacing `docker` with `podman`.

The development image supports the same environment variables as the production build:

```bash
# Test with custom batch sizes
docker run --rm -v $(pwd):/opt/indexer -e INDEXER_DEPLOYMENT_BATCH_SIZE=1000 indexer-dev:latest bash -c "cd /opt/indexer && yarn compile"

# Test with custom stake thresholds
docker run --rm -v $(pwd):/opt/indexer -e INDEXER_MIN_STAKE_THRESHOLD=5000000000000000000 indexer-dev:latest bash -c "cd /opt/indexer && yarn compile"
```

### Troubleshooting

- **Build failures**: Ensure you have sufficient RAM (4GB+) and disk space
- **Permission issues**: On some systems, you may need to use `sudo` with podman/docker commands
- **Volume mount issues**: Ensure the current directory path is correct and accessible
- **Dependency issues**: The image includes `yarn install` to ensure all dependencies are properly resolved

### Performance Testing

**Note**: All `docker` commands in this section can be used with Podman by simply replacing `docker` with `podman`.

To test the performance improvements with large datasets:

```bash
# Test compilation performance
docker run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer && time yarn compile"

# Test individual package compilation
docker run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer/packages/indexer-common && time tsc --noEmit"
```

## Project Structure

The project is organized as a monorepo using [Lerna](https://lerna.js.org/) and [Yarn workspaces](https://classic.yarnpkg.com/en/docs/workspaces/):

```
packages/
├── indexer-agent/     # Main indexer agent service
├── indexer-cli/       # Command-line interface
└── indexer-common/    # Shared utilities and types
```

## Development Workflow

### 1. Setup Development Environment

```bash
# Clone the repository
git clone <repository-url>
cd indexer

# Install dependencies
yarn install

# Build the development image
podman build -f Dockerfile.dev -t indexer-dev:latest .
```

### 2. Make Changes

- Edit files in the appropriate package
- Follow the existing code style and patterns
- Add tests for new functionality

### 3. Test Your Changes

```bash
# Test compilation
podman run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer && yarn compile"

# Run tests
podman run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer && yarn test"

# Test specific functionality
podman run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer/packages/indexer-agent && node bin/graph-indexer-agent start --help"
```

### 4. Commit and Push

```bash
# Add your changes
git add .

# Commit with a descriptive message
git commit -m "feat: description of your changes"

# Push to your branch
git push origin your-branch-name
```

## Performance Optimization Features

The indexer agent includes several performance optimizations for handling large numbers of subgraph deployments:

### Batching and Filtering
- **Deployment Batching**: Processes deployments in configurable batches (default: 500) to prevent event loop blocking
- **Stake Threshold Filtering**: Automatically filters out deployments below a minimum stake/signal threshold to reduce processing overhead
- **Rule Lookup Optimization**: Uses O(1) Map-based lookups instead of O(N) linear scans for indexing rules

### Configuration Options
- `--indexer-min-stake-threshold`: Set minimum stake amount in wei (default: 1 GRT = 1000000000000000000 wei)
- `INDEXER_DEPLOYMENT_BATCH_SIZE`: Environment variable for batch size (default: 500)

### Use Cases
These optimizations are particularly beneficial when:
- Processing 10,000+ subgraph deployments
- Managing complex indexing rule sets
- Running on resource-constrained environments
- Requiring consistent response times during high-load periods

## Testing

### Running Tests Locally

To run the tests locally, you'll need:
1. Docker installed and running
2. Node.js and Yarn
3. An Arbitrum Sepolia testnet RPC provider (e.g., Infura, Alchemy)
4. An API key from The Graph Studio for querying subgraphs

#### Setup

1. Create a `.env` file in the root directory with your credentials. You can copy the example file as a template:
```sh
cp .env.example .env
```

Then edit `.env` with your credentials:
```plaintext
# Your Arbitrum Sepolia testnet RPC endpoint
INDEXER_TEST_JRPC_PROVIDER_URL=https://sepolia.infura.io/v3/your-project-id

# Your API key from The Graph Studio (https://thegraph.com/studio/)
INDEXER_TEST_API_KEY=your-graph-api-key-here
```

2. Run the tests:
```sh
bash scripts/run-tests.sh
```

The script will:
- Start a PostgreSQL container with the required test configuration
- Load your credentials from the `.env` file
- Run the test suite
- Clean up the PostgreSQL container when done

### Using Docker for Testing

**Note**: All `docker` commands in this section can be used with Podman by simply replacing `docker` with `podman`.

```bash
# Run tests in the development container
docker run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer && yarn test"

# Run specific test suites
docker run --rm -v $(pwd):/opt/indexer indexer-dev:latest bash -c "cd /opt/indexer/packages/indexer-agent && yarn test"
```

## Contributing

### Code Style

- Follow the existing TypeScript patterns
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Ensure all tests pass before submitting

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes following the development workflow
3. Ensure all tests pass
4. Update documentation if needed
5. Submit a pull request with a clear description

### Performance Considerations

When making changes that affect performance:
- Test with realistic data sizes (10K+ deployments)
- Use the development container for consistent testing
- Measure performance impact before and after changes
- Consider the O(N×M) complexity implications

## Troubleshooting Common Issues

### Build Issues

**Problem**: `tsc: command not found`
**Solution**: Ensure TypeScript is installed globally in the container or use `yarn tsc`

**Problem**: `lerna: command not found`
**Solution**: Ensure Lerna is installed globally in the container

**Problem**: Dependency resolution errors
**Solution**: Run `yarn install` in the container to ensure proper workspace linking

### Runtime Issues

**Problem**: Container can't mount volumes
**Solution**: Check file permissions and ensure the path is accessible

**Problem**: Insufficient memory during build
**Solution**: Increase container memory limits or use `--memory` flag

**Problem**: Port conflicts
**Solution**: Use different ports or stop conflicting services

**Note**: If you're using Podman instead of Docker, replace `docker` with `podman` in all commands. Podman is a drop-in replacement for Docker and supports the same command-line interface.

## Resources

- [The Graph Protocol Documentation](https://thegraph.com/docs/)
- [Lerna Documentation](https://lerna.js.org/)
- [Yarn Workspaces](https://classic.yarnpkg.com/en/docs/workspaces/)
- [TypeScript Documentation](https://www.typescriptlang.org/)
- [Docker Documentation](https://docs.docker.com/)
- [Podman Documentation](https://podman.io/getting-started/)
