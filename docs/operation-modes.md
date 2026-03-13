# Indexer Agent Operation Modes

The indexer agent can automatically manage your allocations through a **reconciliation loop** - a background process that continuously monitors the network and adjusts your allocations based on your indexing rules.

The **operation mode** controls whether and how this reconciliation loop runs.

## Operation Modes

Configure the mode via `--allocation-management` or `INDEXER_AGENT_ALLOCATION_MANAGEMENT`:

| Mode | Reconciliation Loop | Behavior | Best For |
|------|---------------------|----------|----------|
| **AUTO** (default) | Runs | Agent decides, auto-approves, executes | Hands-off operation |
| **OVERSIGHT** | Runs | Agent decides, queues for your approval | Review before execution |
| **MANUAL** | Skipped | You manage allocations via CLI | Full manual control, 3rd party tools |

For information on how to manage allocations (rules, action queue, direct commands), see the [Allocation Management](./allocation-management/README.md) guide.

---

## What is the Reconciliation Loop?

The reconciliation loop is the agent's core automation mechanism. It periodically:

1. **Evaluates** which deployments you *should* be allocated to (based on your indexing rules)
2. **Compares** that desired state against your actual on-chain allocations
3. **Queues actions** to reconcile the difference (allocate, unallocate, reallocate)

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌─────────────┐
│ Deployment          │ --> │ Allocation               │ --> │ Action      │
│ Evaluation          │     │ Reconciliation           │     │ Executor    │
│                     │     │                          │     │             │
│ "What SHOULD we     │     │ "What do we need to DO   │     │ Execute     │
│  allocate to?"      │     │  to match desired state?"│     │ on-chain    │
└─────────────────────┘     └──────────────────────────┘     └─────────────┘
```

In **AUTO** mode, actions are auto-approved and execute immediately.
In **OVERSIGHT** mode, actions are queued for your approval first.
In **MANUAL** mode, the loop doesn't run at all - you queue actions yourself.

---

## Reconciliation Loop Details

### Polling Intervals

The loop runs on two intervals:

- **Small interval**: `pollingInterval` - for frequently changing data
- **Large interval**: `pollingInterval * 5` - for stable data

### Data Streams

The loop fetches and maintains:

| Data | Interval |
|------|----------|
| Current epoch number | Large |
| Max allocation duration | Large |
| Indexing rules | Small |
| Active deployments on Graph Node | Large (AUTO mode only) |
| Network deployments | Small |
| Active allocations | Small |
| Recently closed allocations | Small |

### Phase 1: Deployment Evaluation

Determines which deployments you *should* be allocated to:

- Fetches all deployments from the network subgraph
- Matches each against your indexing rules (deployment-specific or global)
- Outputs `toAllocate: true/false` for each deployment

**Decision basis options** (from your rules):
- `always` - allocate
- `never` - don't allocate
- `offchain` - index locally but don't allocate on-chain
- `rules` - evaluate against thresholds (`minStake`, `minSignal`, `minAverageQueryFees`)

### Phase 2: Allocation Reconciliation

Compares desired state against actual allocations and queues actions:

| Condition | Action Queued |
|-----------|---------------|
| Should allocate + no active allocation | ALLOCATE |
| Shouldn't allocate + has active allocation | UNALLOCATE |
| Should allocate + allocation expiring | REALLOCATE |

**Expiration check**: `currentEpoch >= createdAtEpoch + allocationLifetime`

---

## Safety Mechanisms

The agent includes safety features to prevent problematic allocations:

1. **Health check**: Won't allocate to deployments with "failed" health status (if `safety=true` in rule)
2. **Zero POI safety**: Won't reallocate if previous allocation closed with zero POI
3. **Approved actions check**: Skips reconciliation if pending approved actions exist (prevents conflicts)
4. **Network subgraph protection**: Never auto-allocated unless explicitly enabled via `--allocate-on-network-subgraph`

---

## Related Documentation

- [Allocation Management Overview](./allocation-management/README.md) - How to manage allocations
- [Indexing Rules](./allocation-management/rules.md) - Configure what the agent should allocate to
- [Action Queue](./allocation-management/action-queue.md) - Queue, approve, and execute allocation actions
- [Direct Commands](./allocation-management/direct.md) - Execute allocation operations immediately
