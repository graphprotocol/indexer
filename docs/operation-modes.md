# Indexer Agent Operation Modes

This document explains the internal workings of the indexer agent, focusing on allocation management, the reconciliation loop, and how indexing rules interact with allocation actions.

## Allocation Management Modes

The agent supports three allocation management modes, configured via `--allocation-management`:

| Mode | Behavior |
|------|----------|
| **AUTO** (default) | Allocation decisions are automatically approved and executed |
| **MANUAL** | Reconciliation is completely skipped; all actions must be manually created via CLI |
| **OVERSIGHT** | Actions are queued but require manual approval before execution |

## The Reconciliation Loop

The reconciliation loop runs continuously with two polling intervals:

- **Small interval**: `pollingInterval` - for frequently changing data
- **Large interval**: `pollingInterval * 5` - for stable data

### Data Streams

The loop fetches and maintains:

1. **Current epoch number** (large interval)
2. **Max allocation duration** (large interval)
3. **Indexing rules** (small interval)
4. **Active deployments on Graph Node** (large interval, AUTO mode only)
5. **Network deployments** (small interval)
6. **Active allocations** (small interval)
7. **Recently closed allocations** (small interval)

### Two-Phase Process

The reconciliation consists of two distinct phases:

#### Phase 1: Deployment Evaluation

**What it does**: Determines which deployments the indexer *should* be allocated to based on indexing rules.

- Takes all network deployments from the network subgraph
- Matches each deployment against indexing rules (deployment-specific or global)
- Outputs allocation decisions with `toAllocate: true/false` for each deployment

**When it runs**: Every `pollingInterval * 5`, but **only in AUTO/OVERSIGHT mode**. Skipped entirely in MANUAL mode.

**Decision basis options**:
- `always` - allocate
- `never` - don't allocate
- `offchain` - index but don't allocate
- `rules` - evaluate against thresholds (`minStake`, `minSignal`, `minAverageQueryFees`)

#### Phase 2: Allocation Reconciliation

**What it does**: Compares desired state (from deployment evaluation) against actual on-chain state and queues actions to resolve differences.

| Condition | Action Queued |
|-----------|---------------|
| `toAllocate=true` + no active allocation | ALLOCATE |
| `toAllocate=false` + active allocation exists | UNALLOCATE |
| `toAllocate=true` + allocation expiring | REALLOCATE |

**Expiration check**: `currentEpoch >= createdAtEpoch + allocationLifetime`

**When it runs**: After deployment evaluation, **only in AUTO/OVERSIGHT mode**. Skipped in MANUAL mode.

### Visual Flow

```
AUTO/OVERSIGHT MODE:
┌─────────────────────┐     ┌──────────────────────────┐     ┌─────────────┐
│ Deployment          │ --> │ Allocation               │ --> │ Action      │
│ Evaluation          │     │ Reconciliation           │     │ Executor    │
│                     │     │                          │     │             │
│ "What SHOULD we     │     │ "What do we need to DO   │     │ Execute     │
│  allocate to?"      │     │  to match desired state?"│     │ on-chain    │
└─────────────────────┘     └──────────────────────────┘     └─────────────┘

MANUAL MODE:
┌─────────────────────┐     ┌──────────────────────────┐     ┌─────────────┐
│ Deployment          │     │ Allocation               │     │ Action      │
│ Evaluation          │     │ Reconciliation           │     │ Executor    │
│                     │     │                          │     │             │
│ SKIPPED             │     │ SKIPPED                  │     │ Still runs! │
└─────────────────────┘     └──────────────────────────┘     └─────────────┘
                                                                   ^
                                                                   |
                                                          Manual CLI actions
                                                          (graph indexer actions queue)
```

## Indexing Rules

### Purpose

Rules serve two purposes:

1. **Allocation decisions** (AUTO/OVERSIGHT only): Determine whether to allocate via `decisionBasis` and threshold fields
2. **Deployment management** (ALL modes): Control what to index on Graph Node, provide defaults for manual actions

### Management

Rules are primarily managed through:

- **CLI**: `graph indexer rules set/delete/clear/get`
- **GraphQL API**: Direct mutations to the indexer management server

### Automatic Rule Modifications

**Important**: Allocation actions automatically modify rules to maintain consistency:

| Action | Rule Modification |
|--------|------------------|
| **ALLOCATE** | Creates rule with `decisionBasis: ALWAYS` if no matching rule exists |
| **UNALLOCATE** | **Always** sets rule to `decisionBasis: NEVER` |
| **REALLOCATE** | Creates rule with `decisionBasis: ALWAYS` if no matching rule exists |

This means:
- After unallocating, you must manually change the rule back to `ALWAYS` or `RULES` if you want to allocate again
- The agent won't fight against manual allocation actions (it creates rules to match)

## Safety Mechanisms

The agent includes several safety features:

1. **Health check**: Won't allocate to deployments with "failed" health status if rule has `safety=true`
2. **Zero POI safety**: Won't reallocate if previous allocation closed with zero POI and safety is enabled
3. **Approved actions check**: Skips reconciliation if there are already pending approved actions (prevents conflicts)
4. **Network subgraph protection**: Never auto-allocated unless explicitly enabled via `--allocate-on-network-subgraph`

## Action Execution

Actions flow through the action queue regardless of mode:

1. **AUTO mode**: Actions are queued with `APPROVED` status and executed automatically
2. **OVERSIGHT mode**: Actions are queued with `QUEUED` status, require manual approval
3. **MANUAL mode**: No automatic actions; user queues actions via CLI with desired status

The action executor runs in all modes - in MANUAL mode it simply has no auto-generated actions to process.
