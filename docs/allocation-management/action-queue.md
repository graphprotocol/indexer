# Action Queue

The action queue provides a staged approach to allocation management. Actions are queued, reviewed, approved, and then executed by a background worker. This enables oversight, batching, and integration with third-party tools.

## How It Works

1. Actions are added to the queue (by agent, CLI, or GraphQL API)
2. Actions sit in `queued` status until approved
3. Approved actions are picked up by the execution worker
4. Worker executes actions on-chain and updates status

The execution worker polls for approved actions every ~30 seconds.

## CLI Commands

```bash
# View actions
graph indexer actions get all
graph indexer actions get --status queued
graph indexer actions get --status approved
graph indexer actions get --orderBy createdAt --orderDirection desc

# Queue actions
graph indexer actions queue allocate <deployment-id> <amount>
graph indexer actions queue unallocate <deployment-id> <allocation-id>
graph indexer actions queue reallocate <deployment-id> <allocation-id> <amount>
graph indexer actions queue present-poi <deployment-id> <allocation-id>    # Horizon only
graph indexer actions queue resize <deployment-id> <allocation-id> <amount> # Horizon only

# Approve actions
graph indexer actions approve <action-id> [<action-id> ...]
graph indexer actions approve queued  # Approve all queued actions

# Cancel/delete actions
graph indexer actions cancel <action-id> [<action-id> ...]
graph indexer actions delete <action-id> [<action-id> ...]

# Update action parameters
graph indexer actions update --status queued --type reallocate force true poi 0x...

# Force immediate execution of approved actions
graph indexer actions execute approved
```

## Action Types

### allocate
Allocate stake to a subgraph deployment.

Required parameters:
- `deploymentID` - The subgraph deployment ID
- `amount` - Amount of GRT to allocate

### unallocate
Close an existing allocation.

Required parameters:
- `deploymentID` - The subgraph deployment ID
- `allocationID` - The allocation to close

Optional parameters:
- `poi` - Proof of indexing to submit
- `force` - Force using provided POI even if it doesn't match graph-node

### reallocate
Atomically close an allocation and open a new one for the same deployment.

Required parameters:
- `deploymentID` - The subgraph deployment ID
- `allocationID` - The allocation to close
- `amount` - Amount of GRT for the new allocation

Optional parameters:
- `poi` - Proof of indexing to submit
- `force` - Force using provided POI

### present-poi (Horizon only)
Collect indexing rewards by presenting a POI without closing the allocation.

Required parameters:
- `deploymentID` - The subgraph deployment ID
- `allocationID` - The allocation

Optional parameters:
- `poi` - Proof of indexing
- `blockNumber` - Block number the POI was computed at
- `publicPOI` - Public POI (must be same block height as POI)
- `force` - Force using provided POI

### resize (Horizon only)
Change the allocated stake amount without closing the allocation.

Required parameters:
- `deploymentID` - The subgraph deployment ID
- `allocationID` - The allocation
- `amount` - New allocation amount

## Action Statuses

| Status | Description |
|--------|-------------|
| `queued` | Waiting for approval |
| `approved` | Ready for execution |
| `pending` | Being executed |
| `success` | Executed successfully |
| `failed` | Execution failed |
| `canceled` | Canceled before execution |

## GraphQL API

The indexer management server exposes a GraphQL endpoint (default port 18000) for programmatic access.

### Queries

```graphql
type Query {
  action(actionID: String!): Action
  actions(
    filter: ActionFilter
    orderBy: ActionParams
    orderDirection: OrderDirection
    first: Int
  ): [Action]!
}
```

### Mutations

```graphql
type Mutation {
  queueActions(actions: [ActionInput!]!): [Action]!
  approveActions(actionIDs: [String!]!): [Action]!
  cancelActions(actionIDs: [String!]!): [Action]!
  deleteActions(actionIDs: [String!]!): Int!
  updateAction(action: ActionInput!): Action!
  updateActions(filter: ActionFilter!, action: ActionUpdateInput!): [Action]!
  executeApprovedActions: [ActionResult!]!
}
```

### Types

```graphql
input ActionInput {
  status: ActionStatus!
  type: ActionType!
  deploymentID: String
  allocationID: String
  amount: String
  poi: String
  force: Boolean
  source: String!
  reason: String!
  priority: Int!
}

type Action {
  id: Int!
  status: ActionStatus!
  type: ActionType!
  deploymentID: String
  allocationID: String
  amount: String
  poi: String
  force: Boolean
  priority: Int!
  source: String!
  reason: String!
  transaction: String
  createdAt: BigInt!
  updatedAt: BigInt
}

enum ActionStatus {
  queued
  approved
  pending
  success
  failed
  canceled
}

enum ActionType {
  allocate
  unallocate
  reallocate
  presentPOI
  resize
}
```

### Example: Queue Actions via GraphQL

```graphql
mutation queueActions($actions: [ActionInput!]!) {
  queueActions(actions: $actions) {
    id
    type
    deploymentID
    allocationID
    amount
    status
  }
}
```

Variables:
```json
{
  "actions": [
    {
      "status": "queued",
      "type": "allocate",
      "deploymentID": "QmXYZ...",
      "amount": "10000",
      "source": "my-optimizer",
      "reason": "High signal deployment",
      "priority": 0
    }
  ]
}
```

## Integration with Operation Modes

| Mode | Agent Behavior | Your Actions |
|------|---------------|--------------|
| **AUTO** | Queues actions as `approved` | Can still queue your own actions |
| **OVERSIGHT** | Queues actions as `queued` | Must approve before execution |
| **MANUAL** | Doesn't queue anything | Queue and approve manually |

## Third-Party Integration

The action queue enables integration with external allocation optimization tools:

1. Optimizer analyzes network state and identifies optimal allocations
2. Optimizer queues actions via GraphQL API with `status: queued`
3. Indexer reviews queued actions
4. Indexer approves actions via CLI or API
5. Execution worker processes approved actions

This workflow provides human oversight while enabling sophisticated automated decision-making.
