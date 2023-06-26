# Background
In the legacy paradigm the indexer-agent was the sole decision maker in the recommended indexer stack.  It receives direction from the indexer in the form of indexing rules and uses that direction to take allocation management actions, sending transactions to Ethereum Mainnet to execute them. It uses the indexer management server as the source of indexer specific information (indexing rules, indexing deployments, cost models,...), directly queries the network subgraph on the graph-node for network information, and sends transactions directly to the Mainnet chain.

The action queue decouples action execution from decision-making, provide oversight of decisions to indexers, and provide a more clear delineation of concerns in the software.  The indexer management server handles external interactions (data fetching and executing actions) while the indexer agent will be focused on managing the reconciliation loop decision-making process, and ongoing management of allocations. By moving transaction execution and data fetching to the indexer management server, providing the option to turn off the agent's allocation management, and providing an allocation management interface hosted by the indexer management server we open up the design space for 3rd party decision-making software to replace or supplement the agent.

# Usage
The action execution worker will only grab items from the action queue to execute if they have `ActionStatus` = `approved`. In the recommended path actions are added to the queue with `ActionStatus` = `queued`, so they must then be approved in order to be executed on-chain. The indexer-agent now has 3 management modes (set using `--allocation-management` or `INDEXER_AGENT_ALLOCATION_MANAGEMENT`): `auto`, `manual`, and `oversight`.

## Allocation management modes:
- `auto`: The indexer-agent will act similarly to the legacy paradigm. When it identifies allocation actions it will add them to the queue with ActionStatus = `approved`; the execution worker process will pick up the approved actions within 30 seconds and execute them.
- `manual`: The indexer-agent will not add any items to the action queue in this mode. It will spin up an indexer-management server which can be interacted with manually or integrated with 3rd party tools to add actions to the action queue and execute them.
- `oversight`: The indexer-agent will add run its reconciliation loop to make allocation decisions and when actions are identified it will queue them. These actions will then require approval before they can be executed.

## Actions CLI
The indexer-cli provides an `actions` module for manually working with the action queue. It uses the #Graphql API hosted by the indexer management server to interact with the actions queue.

```bash
Manage indexer actions

  indexer actions update     Update one or more actions                 
  indexer actions queue      Queue an action item                       
  indexer actions get        List one or more actions                   
  indexer actions execute    Execute approved items in the action queue 
  indexer actions delete     Delete one or many actions in the queue    
  indexer actions cancel     Cancel an item in the queue                
  indexer actions approve    Approve an action item                     
  indexer actions            Manage indexer actions
```

Local usage from source
```bash
# Fetch all actions in the queue
./bin/graph-indexer indexer actions get all

# Fetch actions by status
./bin/graph-indexer indexer actions get --status queued

# Specify ordering criteria when fetching actions
./bin/graph-indexer indexer actions get --orderBy allocationAmount --orderDirection desc

# Queue allocate action (allocateFrom())
./bin/graph-indexer indexer actions queue allocate QmeqJ6hsdyk9dVbo1tvRgAxWrVS3rkERiEMsxzPShKLco6 5000

# Queue reallocate action (close and allocate using multicall())
./bin/graph-indexer indexer actions queue reallocate QmeqJ6hsdyk9dVbo1tvRgAxWrVS3rkERiEMsxzPShKLco6 0x4a58d33e27d3acbaecc92c15101fbc82f47c2ae5 55000

# Queue unallocate action (closeAllocation())
./bin/graph-indexer indexer actions queue unallocate QmeqJ6hsdyk9dVbo1tvRgAxWrVS3rkERiEMsxzPShKLco6 0x4a58d33e27d3acbaecc92c15101fbc82f47c2ae

# Update all queued reallocate actions, setting force=true and poi=0x0...
./bin/graph-indexer indexer actions update --status queued --type reallocate force true poi 0

# Cancel action in the queue
./bin/graph-indexer indexer actions cancel

# Approve multiple actions for execution
./bin/graph-indexer indexer actions approve 1 3 5

# Approve all queued actions
./bin/graph-indexer indexer actions approve queued

# Force the worker to execute approved actions immediately
./bin/graph-indexer indexer actions execute approve 
```

# GraphQL API
The indexer management server has a graphQL endpoint (defaults to port 18000) that provides an interface for indexer components to fetch or modify indexer control data. It now supports several queries and mutations for interacting with the action queue/worker that allow simple integration with other allocation decision-making tools. 3rd party allocation optimizers can queue or apply actions for the indexer by sending action items to the action queue via the indexer management server.



Action Schema (shortened for focus; the endpoint also includes other methods specified elsewhere)
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

  type Mutation {
    updateAction(action: ActionInput!): Action!
    updateActions(filter: ActionFilter!, action: ActionUpdateInput!): [Action]!
    queueActions(actions: [ActionInput!]!): [Action]!
    cancelActions(actionIDs: [String!]!): [Action]!
    deleteActions(actionIDs: [String!]!): Int!
    approveActions(actionIDs: [String!]!): [Action]!
    executeApprovedActions: [ActionResult!]!
  }
```

## Supported action types for allocation management
`Allocate` - allocate stake to a specific subgraph deployment
- required action params:
    - deploymentID
    - amount

`Unallocate` - close allocation, freeing up the stake to reallocate elsewhere
- required action params:
    - allocationID
    - deploymentID
- optional action params:
    - poi
    - force (forces using the provided POI even if it doesn’t match what the graph-node provides)

`Reallocate` - atomically close allocation and open a fresh allocation for the same subgraph deployment
- required action params:
    - allocationID
    - deploymentID
    - amount
- optional action params:
    - poi
    - force (forces using the provided POI even if it doesn’t match what the graph-node provides)

## How to send actions to the queue?
The queueActions mutation provides an interface for sending an array of actions (ActionInput) to the queue. It is recommended that actions are sent to the queue with status = queued, so the indexer will need to approve the actions before they will be executed by the indexer management server.

Queue actions schema
```graphql
queueActions(actions: [ActionInput!]!): [Action]!

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

input ActionUpdateInput {
    id: Int
    deploymentID: String
    allocationID: String
    amount: Int
    poi: String
    force: Boolean
    type: ActionType
    status: ActionStatus
    reason: String
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

type ActionResult {
    id: Int!
    type: ActionType!
    deploymentID: String
    allocationID: String
    amount: String
    poi: String
    force: Boolean
    source: String!
    reason: String!
    status: String!
    transaction: String
    failureReason: String
    priority: Int
}

input ActionFilter {
    id: Int
    type: ActionType
    status: String
    source: String
    reason: String
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
    collect
} 

enum ActionParams {
    id
    status
    type
    deploymentID
    allocationID
    transaction
    amount
    poi
    force
    source
    reason
    priority
    createdAt
    updatedAt
}
```

Example usage
```graphql
mutation queueActions($actions: [ActionInput!]!) {
  queueActions(actions: $actions) {
    id
    type
    deploymentID
    allocationID
    amount
    poi
    force
    source
    reason
    priority
    status
  }
}
```

## What happens once actions are added to the queue?
The action execution worker will only grab items from the queue to execute if they have ActionStatus = approved. In the recommended path actions are added to the queue with ActionStatus = queued, so they must then be approved in order to be executed on-chain. So the flow in summary will look like:
- Action added to the queue by the 3rd party optimizer tool or indexer-cli user
- Indexer can use the `indexer-cli` to view all queued actions
- Indexer (or other software) can approve or cancel actions in the queue using the `indexer-cli`.  The approve and cancel commands take an array of action ids as input.

    ```bash
    graph-indexer indexer actions approve <actionID> <actionID> ...
    graph-indexer indexer actions cancel <actionID> <actionID> ...
    ```

  example approve command

    ```bash
    graph-indexer indexer actions approve 64 5 76 8
    ```
- The execution worker regularly polls the queue for approved actions. It will grab the `approved` actions from the queue, attempt to execute them, and update the values in the db depending on the status of execution. For example: if an action’s execution is successful it will update its `ActionStatus` to `success` and populate the `transaction` field with the transaction id.
- If an action is successful the worker will ensure that there is an indexing rule present that tells the agent how to manage the allocation moving forward, useful when taking manual actions while the agent is in `auto` or `oversight` mode.  
- The indexer can monitor the action queue to see a history of action execution and if needed re-approve and update action items if they failed execution. The action queue provides a history of all actions queued and taken.
