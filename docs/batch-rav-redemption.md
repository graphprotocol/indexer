# Batch RAV Redemption

## Overview

The indexer-agent now supports batch redemption of RAVs (Rebate Allocation Vouchers) using the Multicall3 contract. This feature significantly reduces gas costs by combining multiple RAV redemptions into a single transaction.

## Background

Previously, RAVs were redeemed one-by-one on the blockchain, leading to:
- High gas costs due to individual transactions for each RAV
- Increased processing time for indexers with multiple allocations
- Poor user experience when managing many allocations

The batch RAV redemption feature addresses these issues by grouping multiple redemptions into a single transaction.

## How It Works

The indexer uses the [Multicall3 contract](https://github.com/mds1/multicall) (deployed at `0xcA11bde05977b3631167028862bE2a173976CA11` on most EVM chains) to batch multiple `escrow.redeem()` calls into a single transaction.

### Key Features

1. **Automatic Batching**: RAVs are automatically grouped based on configured thresholds
2. **Backward Compatibility**: Default configuration maintains single redemption behavior
3. **Fallback Mechanism**: If batch redemption fails, falls back to individual redemptions
4. **Escrow Balance Validation**: Pre-validates escrow balances before batching

## Configuration

Add the following options to your indexer configuration:

### Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ravRedemptionBatchSize` | number | 1 | Number of RAVs to group before triggering batch redemption. Set to 1 to disable batching. |
| `ravRedemptionBatchThreshold` | number (GRT) | 10 | Minimum total value in GRT required to trigger batch redemption |
| `ravRedemptionMaxBatchSize` | number | 20 | Maximum number of RAVs per batch to avoid gas limit issues |

### Example Configuration

```yaml
# In your network specification file (e.g., mainnet.yaml)
indexerOptions:
  # ... other options ...
  
  # Enable batch RAV redemption
  ravRedemptionBatchSize: 10        # Start batching after 10 RAVs
  ravRedemptionBatchThreshold: 50    # Minimum 50 GRT value to batch
  ravRedemptionMaxBatchSize: 25      # Maximum 25 RAVs per batch
```

### Configuration via CLI

You can also set these options via command-line arguments:

```bash
graph-indexer-agent start \
  --rav-redemption-batch-size 10 \
  --rav-redemption-batch-threshold 50 \
  --rav-redemption-max-batch-size 25 \
  # ... other options
```

## Batching Logic

The indexer groups RAVs into batches using the following logic:

1. **Escrow Balance Check**: Filters out RAVs that exceed sender's escrow balance
2. **Batch Formation**: Groups RAVs until either:
   - Batch size reaches `ravRedemptionBatchSize` AND value exceeds `ravRedemptionBatchThreshold`
   - Batch size reaches `ravRedemptionMaxBatchSize`
3. **Threshold Check**: Final batches below `ravRedemptionBatchThreshold` are processed individually

## Monitoring

New metrics are available for monitoring batch redemptions:

| Metric | Description |
|--------|-------------|
| `indexer_agent_rav_batch_redeem_size` | Current size of RAV batches being redeemed |
| `indexer_agent_rav_batch_redeem_success` | Count of successful batch redemptions |
| `indexer_agent_rav_batch_redeem_failed` | Count of failed batch redemptions |

Existing metrics (`indexer_agent_ravs_redeem_duration`, `indexer_agent_rav_exchanges_ok`) continue to track individual RAV redemptions within batches.

## Requirements

- Multicall3 contract must be deployed on the network
- Sufficient gas limit to process batch transactions

## Migration Guide

### Enabling Batch Redemption

1. **Start Conservative**: Begin with small batch sizes to test the feature
   ```yaml
   ravRedemptionBatchSize: 5
   ravRedemptionBatchThreshold: 20
   ravRedemptionMaxBatchSize: 10
   ```

2. **Monitor Performance**: Watch the new metrics and logs
   ```
   INFO: Redeeming RAVs in batches
   INFO: Processing batch 1/2
   INFO: Successfully redeemed RAV batch
   ```

3. **Adjust Parameters**: Increase batch sizes based on network conditions and gas limits

### Disabling Batch Redemption

To disable batching and revert to single redemptions:
```yaml
ravRedemptionBatchSize: 1  # This disables batching
```

## Troubleshooting

### Multicall3 Not Available

If you see this warning:
```
WARN: Multicall3 contract not found at standard address
```

The feature will automatically fall back to individual redemptions. Contact your network administrator about Multicall3 deployment.

### Batch Failures

If batches fail, check:
1. Gas limits - batches may exceed block gas limits
2. Escrow balances - ensure sufficient funds for all RAVs
3. Network congestion - high gas prices may cause timeouts

The indexer automatically falls back to individual redemptions for failed batches.

## Gas Savings

Expected gas savings depend on batch size:
- 5 RAVs: ~40% gas reduction
- 10 RAVs: ~60% gas reduction  
- 20 RAVs: ~70% gas reduction

Actual savings vary by network conditions and RAV complexity.

## Technical Details

For implementation details, see [ADR-001: Batch RAV Redemption](../adrs/001-batch-rav-redemption.md).