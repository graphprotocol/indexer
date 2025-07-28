# Auto-Graft: Automatic Subgraph Dependency Management

## Quick Start

Auto-graft automatically handles subgraph dependencies when deploying grafted subgraphs. It requires an IPFS endpoint to fetch dependency manifests.

### Prerequisites

**Required Configuration - IPFS Endpoint:**

```bash
# Option 1: Environment variable
export INDEXER_AGENT_IPFS_ENDPOINT=https://ipfs.thegraph.com

# Option 2: Command-line argument
graph-indexer-agent start --ipfs-endpoint https://ipfs.thegraph.com
```

Default: `https://ipfs.network.thegraph.com` (if not specified)

## Introduction

### What is Subgraph Grafting?

Subgraph grafting is a powerful feature that allows you to build upon existing subgraphs by "grafting" new subgraphs onto them at a specific block height. This enables you to:
- Reuse existing indexed data instead of re-indexing from genesis
- Speed up initial sync times dramatically
- Build iterative improvements on existing subgraphs
- Fix bugs in subgraphs without losing historical data

### What is Auto-Graft?

Auto-graft is an indexer feature that automatically handles the deployment and synchronization of all graft dependencies when you deploy a grafted subgraph. Without auto-graft, you would need to manually:
1. Identify all dependencies in the graft chain
2. Deploy each dependency in the correct order
3. Sync each dependency to its required block height
4. Pause dependencies to prevent unnecessary indexing

Auto-graft automates this entire process, making grafted subgraph deployments as simple as regular deployments.

### Benefits of Using Auto-Graft

- **Simplicity**: Deploy grafted subgraphs with a single command
- **Reliability**: Ensures dependencies are deployed in the correct order
- **Efficiency**: Automatically pauses dependencies after syncing to save resources
- **Error Prevention**: Handles the entire dependency chain without manual intervention

## How Auto-Graft Works

When you deploy a subgraph with graft configuration, the auto-graft system:

1. **Detects Graft Configuration**: Checks the subgraph manifest for any graft dependencies
2. **Resolves Dependencies**: Recursively fetches all dependencies from IPFS, building the complete dependency chain
3. **Orders Dependencies**: Arranges dependencies from deepest to root, ensuring proper deployment order
4. **Deploys Dependencies**: Automatically creates and deploys any missing dependencies
5. **Syncs to Target Blocks**: Ensures each dependency is synced to its required block height
6. **Pauses Dependencies**: Stops indexing on dependencies after reaching target blocks to save resources

## Prerequisites

Before using auto-graft, ensure you have:

- **Graph Node**: Running with grafting support enabled (grafting is supported on all networks)
- **IPFS Access**: The indexer must be able to fetch subgraph manifests from IPFS (configured via `--ipfs-endpoint` or `INDEXER_AGENT_IPFS_ENDPOINT` environment variable)
- **Indexer Infrastructure**: Standard indexer setup with indexer-agent and indexer-service

## Using Auto-Graft

The beauty of auto-graft is that it requires no configuration or special commands. Simply deploy your grafted subgraph as you would any other subgraph, and auto-graft handles the rest.

### Example Subgraph Manifest with Graft

```yaml
specVersion: 0.0.4
description: My Improved Subgraph
repository: https://github.com/myorg/my-subgraph
schema:
  file: ./schema.graphql
graft:
  base: QmXyZ...  # IPFS hash of the base subgraph
  block: 15000000  # Block number to graft from
dataSources:
  - kind: ethereum/contract
    name: MyContract
    network: mainnet
    source:
      address: "0x1234..."
      abi: MyContract
      startBlock: 15000001  # Must be greater than graft block
    mapping:
      # ... mapping configuration
```

### Deployment Command

Deploy your grafted subgraph using the standard deployment command:

```bash
# Using graph-cli
graph deploy --node http://localhost:8020 my-subgraph

# Or using indexer-cli
graph indexer rules set my-subgraph decisionBasis always
```

That's it! Auto-graft will handle all dependency management automatically.

## Example Workflow

Let's walk through what happens when you deploy a grafted subgraph:

### Step 1: Deploy the Grafted Subgraph

```bash
graph deploy --node http://localhost:8020 my-improved-subgraph
```

### Step 2: Auto-Graft Detects Dependencies

The system detects that your subgraph has a graft configuration and begins resolving dependencies.

**Expected logs:**
```
Auto graft deploy subgraph dependencies
graft dep chain found ["QmBase123...", "QmDep456..."]
```

### Step 3: Dependencies are Deployed

For each missing dependency, auto-graft will:
```
Dependency subgraph not found, creating, deploying and pausing...
name: my-improved-subgraph
deployment: QmBase123...
block_required: 14000000
```

### Step 4: Syncing to Target Blocks

Each dependency is synced to its required block:
```
Begin syncing subgraph deployment to block
subgraph: QmBase123...
targetBlock: 14000000
```

### Step 5: Deployment Complete

Once all dependencies are synced and paused, your main subgraph begins indexing from the graft point.

## Understanding the Process

### Dependency Chain Resolution

Auto-graft recursively resolves the entire dependency chain. For example:
- Your subgraph grafts from Subgraph A at block 15M
- Subgraph A grafts from Subgraph B at block 10M  
- Subgraph B grafts from Subgraph C at block 5M

Auto-graft will:
1. Deploy Subgraph C first and sync to block 5M
2. Deploy Subgraph B and sync to block 10M
3. Deploy Subgraph A and sync to block 15M
4. Finally deploy your subgraph starting from block 15M

### Automatic Pausing

After each dependency reaches its target block, it's automatically paused to:
- Prevent unnecessary indexing beyond the graft point
- Save computational resources
- Ensure data consistency

Auto-graft will check for active allocations before pausing a dependency. If a subgraph has an active allocation (meaning it's still serving queries), it will NOT be automatically paused to prevent service disruption. This ensures that customers can continue querying subgraphs that are actively allocated.

*Note: This allocation check was introduced in v0.24.1*

## Monitoring Auto-Graft

### Key Log Messages

Monitor these log messages to track auto-graft progress:

- `"Auto graft deploy subgraph dependencies"` - Process started
- `"graft dep chain found"` - Dependencies identified
- `"Dependency subgraph found, checking if it's healthy"` - Existing dependency detected
- `"Dependency subgraph not found, creating, deploying and pausing..."` - New dependency being deployed
- `"Begin syncing subgraph deployment to block"` - Syncing in progress
- `"Successfully synced"` - Dependency ready

### Checking Dependency Status

Use indexer-cli to verify dependency status:

```bash
# Check all active deployments
graph indexer status

# Check specific deployment
graph indexer status QmBase123...
```

## Troubleshooting

### Common Issues and Solutions

#### IPFS Connection Errors
**Problem**: Cannot fetch manifest from IPFS
```
Error: IPFS request failed
```
**Solution**: 
- Verify IPFS endpoint is set correctly: `echo $INDEXER_AGENT_IPFS_ENDPOINT`
- Test IPFS connectivity: `curl https://ipfs.thegraph.com/api/v0/version`
- Check firewall/proxy settings
- Ensure IPFS hash is valid

#### Block Sync Timeout
**Problem**: Dependency takes too long to sync
```
Error: Sync to block X deadline of Y minutes reached
```
**Solution**:
- Increase sync timeout if needed
- Check Graph Node performance
- Verify the chain is fully synced

#### Missing Dependencies
**Problem**: Dependency subgraph not found
```
Error: Subgraph not found in indexing status
```
**Solution**:
- Ensure the dependency IPFS hash is correct
- Verify the dependency was successfully created
- Check Graph Node logs for deployment errors

#### Circular Dependencies
**Problem**: Subgraphs reference each other
**Solution**: 
- Review graft configuration
- Ensure dependency chain is linear
- Fix circular references in manifests

## Best Practices

### 1. Plan Your Graft Points
- Choose stable blocks (finalized, well-tested data)
- Consider chain reorganization risks
- Document why specific blocks were chosen

### 2. Test Dependencies First
- Verify base subgraphs are healthy before grafting
- Ensure dependencies index correctly to target blocks
- Test the complete graft chain in development

### 3. Monitor Resource Usage
- Watch for memory/CPU usage during dependency sync
- Plan for temporary increased resource needs
- Consider dependency sync times in deployment schedules

### 4. Keep Dependency Chains Short
- Limit graft depth when possible
- Consider consolidating long chains
- Document the full dependency tree

### 5. Version Control
- Track graft configurations in version control
- Document dependency relationships
- Maintain deployment history

## Advanced Considerations

### Performance Impact
- Initial deployment may take longer due to dependency syncing
- Once deployed, grafted subgraphs perform identically to regular subgraphs
- Resource usage temporarily increases during dependency deployment

### Chain Reorganizations
- Ensure graft blocks are sufficiently confirmed
- Monitor for reorgs that might affect graft points
- Have contingency plans for graft point issues

### Upgrading Grafted Subgraphs
- New versions can graft from previous versions
- Auto-graft handles version chains automatically
- Consider consolidating long version chains periodically

## Advanced Configuration

### IPFS Endpoint Configuration

#### Using a Local IPFS Node
```bash
# If running local IPFS
export INDEXER_AGENT_IPFS_ENDPOINT=http://localhost:5001

# Ensure your IPFS node has the required content
ipfs pin add QmBaseSubgraphHash
```

#### Using Custom IPFS Gateways
```bash
# Any IPFS gateway supporting the HTTP API
export INDEXER_AGENT_IPFS_ENDPOINT=https://your-ipfs-gateway.com
```

#### Docker Compose Configuration
```yaml
services:
  indexer-agent:
    environment:
      INDEXER_AGENT_IPFS_ENDPOINT: https://ipfs.thegraph.com
      # ... other env vars
```

#### Startup Script Configuration
```bash
#!/bin/bash
export INDEXER_AGENT_IPFS_ENDPOINT=https://ipfs.thegraph.com
export INDEXER_AGENT_ETHEREUM=...
export INDEXER_AGENT_GRAPH_NODE_QUERY_ENDPOINT=...
# ... other configs

graph-indexer-agent start
```

### IPFS Endpoint Requirements
- Must be accessible from your indexer
- Uses IPFS HTTP API v0 format (`/api/v0/cat`)
- Recommended production endpoint: `https://ipfs.thegraph.com`

## Conclusion

Auto-graft simplifies the deployment of grafted subgraphs by automatically managing all dependencies. By understanding how it works and following best practices, you can leverage grafting to build more efficient and maintainable subgraphs while saving significant indexing time and resources.

Remember: The key requirement is a properly configured IPFS endpoint. Once that's set up, auto-graft handles all the complexity of dependency management automatically!