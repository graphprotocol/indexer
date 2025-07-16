# ADR-001: Batch RAV Redemption

## Status

Proposed

## Context

Currently, RAVs (Rebate Allocation Vouchers) are redeemed one-by-one on the blockchain, as noted in the code comment:
```typescript
// Redeem RAV one-by-one as no plual version available
```

This approach leads to several issues:
- High gas costs due to individual transactions for each RAV
- Increased time to process multiple RAVs
- Poor user experience for indexers with many allocations
- Community frustration as expressed in [Issue #1020](https://github.com/graphprotocol/indexer/issues/1020)

The TAP (Timeline Aggregation Protocol) escrow contract does not provide a native batch redeem function like the allocation exchange contract's `redeemMany()` function used for vouchers.

### Existing Multicall Patterns in Codebase

The Graph Protocol staking contract has built-in multicall support, which is used for batching allocation operations (e.g., reallocate = close + allocate). However, the TAP escrow contract lacks this functionality, requiring us to use an external multicall solution.

## Decision

We will implement batch RAV redemption using the Multicall3 contract, which is a standard contract deployed on most EVM chains at address `0xcA11bde05977b3631167028862bE2a173976CA11`.

### Configuration Parameters

Three new configuration options will be added to `IndexerOptions`:

1. **`ravRedemptionBatchSize`** (number, default: 1)
   - Controls whether batching is enabled
   - Value of 1 preserves original single-redemption behavior
   - Values > 1 enable batch redemption

2. **`ravRedemptionBatchThreshold`** (BigNumber, default: 10 GRT)
   - Minimum aggregate value required to trigger batch redemption
   - Prevents batching low-value RAVs where gas savings would be minimal

3. **`ravRedemptionMaxBatchSize`** (number, default: 20)
   - Maximum number of RAVs per batch transaction
   - Prevents transactions from exceeding block gas limits

### Implementation Approach

1. **Multicall3 Integration**
   - Create contract bindings for Multicall3's `aggregate()` function
   - Encode multiple `escrow.redeem()` calls into a single transaction

2. **Backward Compatibility**
   - Default configuration maintains existing behavior
   - Indexers must explicitly opt-in to batching

3. **Error Handling**
   - If batch transaction fails, fall back to individual redemption
   - Log detailed errors for debugging
   - Maintain separate metrics for batch vs individual redemptions

4. **Escrow Balance Verification**
   - Check aggregate escrow balance before batching
   - Exclude RAVs that would exceed sender's escrow balance

## Consequences

### Positive

- **Gas Savings**: Significant reduction in transaction costs (estimated 40-60% for batches of 10+)
- **Improved Performance**: Faster processing of multiple RAVs
- **Better UX**: Indexers can efficiently manage multiple allocations
- **Configurable**: Flexible configuration allows optimization per network
- **Backward Compatible**: No breaking changes for existing deployments

### Negative

- **Complexity**: Additional code complexity for batch handling
- **Multicall3 Dependency**: Requires Multicall3 deployment on the network
- **Batch Failure Risk**: Entire batch fails if one RAV is invalid (mitigated by validation)
- **Gas Limit Constraints**: Large batches may hit block gas limits

### Technical Considerations

1. **Gas Estimation**: Must accurately estimate gas for batch transactions
2. **Atomic Execution**: All RAVs in batch succeed or fail together
3. **Monitoring**: New metrics needed for batch redemption performance
4. **Testing**: Comprehensive tests for various batch scenarios

## Implementation Phases

1. **Phase 1**: Add configuration schema and Multicall3 integration
2. **Phase 2**: Implement batch logic in TapCollector
3. **Phase 3**: Add metrics and monitoring
4. **Phase 4**: Testing and documentation
5. **Phase 5**: Gradual rollout with conservative default settings

## Alternatives Considered

1. **Wait for TAP Contract Update**: Rejected due to unknown timeline
2. **Custom Batch Contract**: Rejected due to deployment complexity and security risks
3. **Direct Multicall on Escrow**: Not possible as escrow doesn't have multicall support

## References

- [Issue #1020: Batch RAV redeem](https://github.com/graphprotocol/indexer/issues/1020)
- [Multicall3 Contract](https://github.com/mds1/multicall)
- [TAP Contracts Documentation](https://github.com/semiotic-ai/tap-contracts)