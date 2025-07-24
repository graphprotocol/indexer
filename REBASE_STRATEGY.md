# DIPs-Horizon Rebase Strategy

## Overview
This document tracks the merge conflict resolution strategy for rebasing DIPs (Distributed Indexing Payments) onto the Horizon branch.

- **DIPs Branch**: Adds distributed indexing payments functionality
- **Horizon Branch**: Adds Graph Horizon protocol upgrade with GraphTally/RAV v2

## Conflict Files (8 total)

### 1. packages/indexer-common/src/network.ts
**Status**: ❌ Unresolved

**Horizon Changes**:
- Imports `GraphTallyCollector` and `encodeRegistrationData`
- Adds `graphTallyCollector: GraphTallyCollector | undefined` property
- Adds `isHorizon: Eventual<boolean>` property
- Creates GraphTallyCollector instance for RAV v2

**DIPs Changes**:
- Imports `DipsCollector`
- Adds `dipsCollector: DipsCollector | undefined` property
- Adds `queryFeeModels: QueryFeeModels` property
- Adds `managementModels: IndexerManagementModels` property

**Key Conflicts**:
1. Import section (lines 41-46)
2. Class properties (lines 58-72)
3. Constructor parameters (lines 86-92)
4. Constructor body (lines 106-112)
5. Network instantiation (lines 396-399)

**Resolution Strategy**:
- [ ] Merge both collectors (GraphTallyCollector AND DipsCollector)
- [ ] Keep all properties from both branches
- [ ] Update constructor to accept all parameters
- [ ] Ensure both collectors can be initialized

---

### 2. packages/indexer-common/src/operator.ts
**Status**: ❌ Unresolved

**Horizon Changes**:
- `createAllocation` method takes `isHorizon: boolean` parameter
- Uses `isHorizon` to determine `isLegacy` flag on actions
- Passes `isLegacy: !isHorizon` to queueAction
- Also sets `isLegacy: allocation.isLegacy` when closing allocations

**DIPs Changes**:
- `createAllocation` method takes `forceAction: boolean = false` parameter
- `queueAction` method signature changed to `async queueAction(action: ActionItem, forceAction: boolean = false)`
- Passes forceAction as second parameter to queueAction

**Key Conflicts**:
1. createAllocation method signature (line 366-370)
2. queueAction calls - Horizon passes object with isLegacy, DIPs passes forceAction as 2nd param
3. closeEligibleAllocations also has forceAction parameter in DIPs
4. refreshExpiredAllocations has similar conflicts

**Resolution Strategy**:
- [ ] Need both isHorizon AND forceAction parameters in allocation methods
- [ ] Update method signatures: `createAllocation(logger, decision, lastClosed, isHorizon, forceAction = false)`
- [ ] Merge queueAction calls to include both isLegacy (from Horizon) and forceAction (from DIPs)

---

### 3. packages/indexer-common/src/query-fees/models.ts
**Status**: ❌ Unresolved

**Horizon Changes**:
- Uses simpler Model type: `extends Model<ScalarTapReceiptsAttributes>`
- id property is `public id!: number`

**DIPs Changes**:
- Uses Model with creation attributes: `extends Model<ScalarTapReceiptsAttributes, ScalarTapReceiptsCreationAttributes>`
- id property is `public id!: CreationOptional<number>`

**Key Conflicts**:
- Single conflict at line 28-37 in ScalarTapReceipts class definition

**Resolution Strategy**:
- [ ] Use DIPs version (more complete typing with CreationOptional)

---

### 4. packages/indexer-common/package.json
**Status**: ❌ Unresolved

**Horizon Changes**:
- `@graphprotocol/common-ts`: "3.0.1" (newer)
- `@graphprotocol/toolshed`: "0.6.5"
- `@semiotic-labs/tap-contracts-bindings`: "2.0.0" (newer)

**DIPs Changes**:
- `@graphprotocol/common-ts`: "2.0.11" (older)
- `@semiotic-labs/tap-contracts-bindings`: "^1.2.1" (older)
- Adds DIPs-specific dependencies:
  - `@bufbuild/protobuf`: "2.2.3"
  - `@graphprotocol/dips-proto`: "0.2.2"
  - `@grpc/grpc-js`: "^1.12.6"

**Key Conflicts**:
- Dependency version mismatches

**Resolution Strategy**:
- [ ] Use Horizon's newer versions
- [ ] Add DIPs-specific dependencies

---

### 5. packages/indexer-common/src/indexer-management/allocations.ts
**Status**: ❌ Unresolved

**Horizon Changes**:
- Empty constructor body

**DIPs Changes**:
- Constructor initializes DipsManager if dipperEndpoint is configured
- Adds `dipsManager: DipsManager | null` property

**Key Conflicts**:
- Constructor body (lines 131-139)

**Resolution Strategy**:
- [ ] Keep DIPs initialization logic

---

### 6. packages/indexer-common/src/indexer-management/resolvers/allocations.ts
**Status**: ❌ Unresolved

**Horizon Changes**:
- Destructures `graphNode` from resolver context

**DIPs Changes**:
- Destructures `actionManager` from resolver context

**Key Conflicts**:
- reallocateAllocation resolver context destructuring (lines 1720-1724)

**Resolution Strategy**:
- [ ] Include BOTH in destructuring: `{ logger, models, multiNetworks, graphNode, actionManager }`
- [ ] The IndexerManagementResolverContext interface already has both properties

---

### 7. packages/indexer-agent/src/agent.ts
**Status**: ❌ Unresolved

**Horizon Changes**:
- Passes `isHorizon` to createAllocation

**DIPs Changes**:
- Passes `forceAction` to createAllocation

**Key Conflicts**:
- createAllocation call (lines 1243-1247)

**Resolution Strategy**:
- [ ] Pass both parameters: `createAllocation(logger, decision, lastClosed, isHorizon, forceAction)`

---

### 8. yarn.lock
**Status**: ❌ Unresolved

**Resolution Strategy**:
- [ ] Will regenerate after resolving package.json conflicts

---

## General Notes
- Both branches introduce different payment/collection systems that need to coexist
- Horizon introduces protocol upgrade detection and legacy/horizon mode switching
- DIPs introduces indexing agreements and gateway payment integration

## Important Context
- **Current branch**: dips-horizon-rebase
- **Base commit**: Squashed DIPs changes into single commit (35ceac2a) on top of 32d8f174
- **Rebase status**: `git rebase origin/horizon` in progress with conflicts
- **To continue rebase**: After resolving conflicts, use `git add <files>` then `git rebase --continue`
- **To abort**: `git rebase --abort` if needed

## Key Files/Imports Added by Each Branch
**Horizon**:
- `GraphTallyCollector` from './allocations/graph-tally-collector'
- `encodeRegistrationData` from '@graphprotocol/toolshed'
- `isHorizon` property for protocol upgrade detection
- `isLegacy` flag on actions

**DIPs**:
- `DipsCollector` from './indexing-fees/dips'
- `DipsManager` class
- DIPs-specific dependencies in package.json
- `forceAction` parameter for manual allocation management
- New directory: `indexing-fees/` with DIPs implementation

## Important Note: Method Call Analysis

**Call sites found for modified methods:**
- `createAllocation`: Only 1 call in agent.ts (already in conflict)
- `closeEligibleAllocations`: 2 calls in agent.ts (already have forceAction parameter)
- `refreshExpiredAllocations`: 1 call in agent.ts (already has forceAction parameter)
- `queueAction`: 5 calls in operator.ts (all in conflicts)

**Good news**: All method calls appear to be either:
1. Already in merge conflicts (so we'll handle them)
2. Already updated with the DIPs parameters (forceAction)

**Action needed**: When resolving conflicts, ensure we add BOTH parameters where needed.

## Resolution Summary

### High Priority Decisions Needed:
1. **Method Signatures**: Most conflicts are about method parameters. We need both `isHorizon` (from Horizon) AND `forceAction` (from DIPs)
2. **Collectors**: We need both GraphTallyCollector (Horizon) and DipsCollector (DIPs) to coexist
3. **Dependencies**: Use Horizon's newer versions but add DIPs-specific dependencies

### Recommended Approach:
1. Start with package.json - merge dependencies
2. Fix network.ts - ensure both collectors can exist
3. Fix operator.ts - update method signatures to accept both parameters
4. Fix agent.ts - pass both parameters
5. Fix remaining files with minor conflicts
6. Regenerate yarn.lock

### Key Principle:
Both payment systems (Horizon's GraphTally and DIPs) should coexist. The system should support:
- Legacy allocations (pre-Horizon)
- Horizon allocations (with GraphTally/RAV v2)
- DIPs agreements (with distributed indexing payments)