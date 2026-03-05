# Bug Report: Batch unallocate can collect rewards without closing allocations when over-allocated

## Summary

When an indexer is over-allocated and closes multiple Horizon allocations in a single batch, some allocations may collect indexing rewards without being closed. This occurs because the `isOverAllocated` check is performed once per allocation at **transaction preparation time**, but the actual over-allocation state changes during **transaction execution time** as allocations are closed sequentially within the multicall.

## Affected Code

- `packages/indexer-common/src/indexer-management/allocations.ts`
  - `populateUnallocateTransaction()` (lines 1105-1193)
  - `prepareTransactions()` (lines 541-564)

## Root Cause

When preparing unallocate transactions for Horizon allocations, the code checks `isOverAllocated` to determine whether to:
- **If over-allocated**: Only call `collect()` (contract will auto-close the allocation)
- **If not over-allocated**: Multicall `collect()` + `stopService()`

```typescript
// allocations.ts:1129-1130
const isOverAllocated = await this.network.contracts.SubgraphService.isOverAllocated(params.indexer)

if (isOverAllocated) {
  // Only prepare collect() - assumes contract will auto-close
  return collect_only_transaction
} else {
  // Prepare collect() + stopService() multicall
  return [collect_calldata, stopService_calldata]
}
```

**The problem:** This check happens at preparation time, before any transactions execute. When multiple unallocate actions are batched together:

1. All actions are prepared with `collect()` only (because `isOverAllocated` returns `true` for all of them)
2. All `collect()` calls are batched into a single `SubgraphService.multicall()`
3. During execution, the first few `collect()` calls auto-close allocations (reducing allocated stake)
4. Once enough allocations close, the indexer is **no longer over-allocated**
5. The remaining `collect()` calls execute but **do not auto-close** because the contract only auto-closes when the indexer is over-allocated at that moment

## Steps to Reproduce

1. Set up an indexer that is over-allocated (e.g., over-allocated by the equivalent of 5 allocations)
2. Have 10 active Horizon allocations
3. Queue 10 UNALLOCATE actions (either manually or via indexer rules)
4. Let the indexer-agent execute the batch

**Expected behavior:** All 10 allocations should be closed with rewards collected.

**Actual behavior:**
- First ~5 allocations: closed (rewards collected, auto-closed while over-allocated)
- Remaining ~5 allocations: **still open** (rewards collected, but not closed)

## Impact

- **Rewards leakage**: Indexers may unintentionally collect rewards without closing allocations
- **Stuck allocations**: Allocations remain open when they should have been closed
- **Unexpected state**: The indexer-agent believes it closed allocations, but they remain active on-chain
- **Potential protocol violations**: Could be seen as gaming the reward system (collecting without closing)

## Suggested Fix

### Option 1: Always include `stopService()` in the multicall (Recommended)

Instead of conditionally including `stopService()`, always prepare both `collect()` and `stopService()` calls. The contract should handle the case where the allocation was already auto-closed gracefully, or the code should catch and ignore the "AllocationClosed" revert for subsequent calls.

```typescript
// Always prepare both calls
const collectCallData = contracts.SubgraphService.interface.encodeFunctionData('collect', [...])
const stopServiceCallData = contracts.SubgraphService.interface.encodeFunctionData('stopService', [...])

// Use tryMulticall or handle reverts gracefully
return [collectCallData, stopServiceCallData]
```

### Option 2: Process unallocates sequentially when over-allocated

If over-allocated, process unallocate actions one at a time rather than batching them, re-checking `isOverAllocated` before each transaction.

### Option 3: Re-check over-allocation status after each collect in the batch

Split the batch execution to re-evaluate the over-allocation status after each allocation is processed.

## Additional Context

- This bug only affects **Horizon allocations** (not legacy allocations)
- This bug only manifests when:
  - The indexer is over-allocated
  - Multiple allocations are being closed in the same batch
  - Closing some allocations would bring the indexer out of over-allocation
- The bug does not occur when closing a single allocation or when not over-allocated

## Related Code References

- Over-allocation check: `allocations.ts:1129-1130`
- Batch preparation: `allocations.ts:541-564` (`prepareTransactions`)
- Multicall execution: `allocations.ts:274-290` (`SubgraphService.multicall`)
- Comment assuming auto-close: `allocations.ts:1127` ("collect() will auto-close the allocation")
