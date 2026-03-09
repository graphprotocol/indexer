# Allocation Management

There are three ways to manage allocations, ranging from fully automated to fully manual:

| Method | How it works | When to use |
|--------|--------------|-------------|
| **[Indexing Rules](./rules.md)** | Set rules, let the agent decide | Automated or semi automated management in AUTO/OVERSIGHT mode |
| **[Action Queue](./action-queue.md)** | Queue actions, approve, execute | Batching, 3rd party tools |
| **[Direct Commands](./direct.md)** | Execute immediately on-chain | One-off operations, debugging, immediate control |

## Indexing Rules

You define rules that specify which deployments to allocate to and how much stake to use. The agent's [reconciliation loop](../operation-modes.md) evaluates these rules and queues the necessary actions automatically using the [action queue](./action-queue.md).

```bash
graph indexer rules set QmXYZ... decisionBasis always allocationAmount 10000
```

**Best for:** Hands-off operation where you want the agent to manage allocations based on criteria like signal, stake thresholds, or explicit deployment lists.

**Requires:** AUTO or OVERSIGHT mode. In MANUAL mode, the reconciliation loop is skipped and rules have no effect.

→ [Full documentation](./rules.md)

## Action Queue

Actions are queued, reviewed, approved, and then executed by a background worker. This gives you oversight and control over what gets executed on-chain.

```bash
graph indexer actions queue allocate QmXYZ... 10000
graph indexer actions approve 1
```

**Best for:**
- Reviewing actions before execution (especially in OVERSIGHT mode)
- Batching multiple operations
- Integrating with 3rd party allocation optimizers
- Maintaining a history of all allocation actions

**Works in all modes.** In AUTO/OVERSIGHT, the agent also queues actions here. In MANUAL, you queue everything yourself.

→ [Full documentation](./action-queue.md)

## Direct Commands

Execute allocation operations immediately on the blockchain, bypassing the action queue entirely.

```bash
graph indexer allocations create QmXYZ... 10000 --network arbitrum-one
```

**Best for:** One-off operations, debugging, or when you need immediate execution without waiting for the queue cycle.

**Works in all modes.** These commands always execute immediately regardless of operation mode.

→ [Full documentation](./direct.md)

---

## Automatic Rule Updates

When allocation actions execute, via manually queuing actions or running direct commands, indexing rules are automatically updated to keep the agent in sync:

| Action | Rule Update |
|--------|-------------|
| `allocate` | Sets `decisionBasis: ALWAYS` |
| `unallocate` | Sets `decisionBasis: OFFCHAIN` |
| `reallocate` | Sets `decisionBasis: ALWAYS` |
| `resize` | Sets `decisionBasis: ALWAYS` |
| `present-poi` | No change |
| `collect` | No change |

This prevents the agent from fighting your manual changes in AUTO/OVERSIGHT mode.
