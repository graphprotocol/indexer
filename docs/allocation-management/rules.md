# Indexing Rules

Indexing rules tell the agent which subgraph deployments to allocate to and how much stake to allocate. The agent's reconciliation loop evaluates these rules and queues allocation actions accordingly using the action queue. For details on the action queue internals read [Action Queue](./action-queue.md).

**Note:** Rules only drive automatic allocation decisions in **AUTO** and **OVERSIGHT** modes. In **MANUAL** mode, the reconciliation loop is skipped entirely.

## CLI Commands

```bash
# Set a rule for a specific deployment
graph indexer rules set <deployment-id> <key> <value> [<key> <value> ...]

# Set the global (default) rule
graph indexer rules set global <key> <value> [<key> <value> ...]

# Get rules
graph indexer rules get all
graph indexer rules get <deployment-id>
graph indexer rules get global

# Delete a rule
graph indexer rules delete <deployment-id>

# Clear all rules (keeps global)
graph indexer rules clear

# Shorthand commands
graph indexer rules start <deployment-id>    # Set decisionBasis to 'always'
graph indexer rules stop <deployment-id>     # Set decisionBasis to 'never'
graph indexer rules maybe <deployment-id>    # Set decisionBasis to 'rules'
graph indexer rules prepare <deployment-id>  # Set decisionBasis to 'offchain'
```

## Rule Parameters

### Decision Basis

The `decisionBasis` field determines whether the agent should allocate to a deployment:

| Value | Behavior |
|-------|----------|
| `always` | Always allocate to this deployment |
| `never` | Never allocate to this deployment |
| `offchain` | Index the deployment but don't allocate (no on-chain stake) |
| `rules` | Evaluate against threshold parameters (see below) |

### Threshold Parameters

When `decisionBasis` is set to `rules`, these thresholds determine allocation eligibility:

| Parameter | Description |
|-----------|-------------|
| `minStake` | Minimum total stake on the deployment |
| `minSignal` | Minimum curation signal on the deployment |
| `minAverageQueryFees` | Minimum average query fees |
| `maxSignal` | Maximum signal (to avoid over-allocated deployments) |
| `maxAllocationPercentage` | Maximum percentage of indexer's stake to allocate |

### Allocation Parameters

| Parameter | Description |
|-----------|-------------|
| `allocationAmount` | Amount of GRT to allocate |
| `allocationLifetime` | Number of epochs before reallocating |
| `parallelAllocations` | Number of parallel allocations to maintain |

### Safety Parameters

| Parameter | Description |
|-----------|-------------|
| `safety` | Enable safety checks (won't allocate to failed deployments) |
| `requireSupported` | Only allocate if deployment is on a supported network |
| `autoRenewal` | Automatically reallocate when allocation expires |

## Global vs Deployment-Specific Rules

- **Global rule**: Default values applied to all deployments
- **Deployment-specific rule**: Overrides global values for a specific deployment

The agent merges rules, with deployment-specific values taking precedence over global defaults.

## Example Usage

```bash
# Set global defaults
graph indexer rules set global \
  decisionBasis rules \
  minSignal 100 \
  minStake 1000 \
  allocationAmount 10000 \
  safety true

# Always allocate to a specific high-value deployment
graph indexer rules set QmXYZ... \
  decisionBasis always \
  allocationAmount 50000

# Index but don't allocate to a deployment (offchain indexing)
graph indexer rules set QmABC... \
  decisionBasis offchain

# Stop allocating to a deployment
graph indexer rules stop QmDEF...
```

## How Rules Drive the Reconciliation Loop

1. Agent fetches all deployments from the network subgraph
2. For each deployment, finds the applicable rule (deployment-specific or global)
3. Evaluates the `decisionBasis`:
   - `always` → should allocate
   - `never` → should not allocate
   - `offchain` → should not allocate (but index locally)
   - `rules` → evaluate against thresholds
4. Compares desired state against current allocations
5. Queues actions to reconcile differences:
   - No allocation but should have one → queue `allocate`
   - Has allocation but shouldn't → queue `unallocate`
   - Allocation expiring → queue `reallocate`