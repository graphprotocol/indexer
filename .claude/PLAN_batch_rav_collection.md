# Batch RAV Collection Implementation Plan

## Overview

Add batched RAV collection using `SubgraphService.multicall()` to reduce on-chain transactions. Instead of 1000 RAVs = 1000 transactions, we batch them (default 50 per batch) = 20 transactions.

## Key Design Decisions

1. **Batch size**: Configurable via `--rav-collection-max-batch-size`, default 50
2. **Two-phase validation**:
   - **Phase 1 (Sequential)**: Escrow balance checks - must be sequential to prevent race conditions where multiple RAVs could pass validation against the same escrow balance
   - **Phase 2 (Parallel)**: `estimateGas` validation - can run in parallel since each call validates against independent on-chain state (signature validity, not-already-redeemed, etc.)
3. **Multicall**: Use existing `SubgraphService.multicall()` pattern from allocations
4. **Event parsing**: Parse multiple `PaymentCollected` events from single tx receipt

---

## Files to Modify

### 1. CLI Option Definition
**File:** `packages/indexer-agent/src/commands/start.ts`

Add new option near line 282 (after `voucher-redemption-max-batch-size`):

```typescript
.option('rav-collection-max-batch-size', {
  description: 'Maximum number of RAVs to collect in a single multicall transaction',
  type: 'number',
  default: 50,
  group: 'Query Fees',
})
```

Add to indexerOptions mapping (~line 408):
```typescript
ravCollectionMaxBatchSize: argv.ravCollectionMaxBatchSize,
```

### 2. Schema Definition
**File:** `packages/indexer-common/src/network-specification.ts`

Add to IndexerOptions schema (~line 58):
```typescript
ravCollectionMaxBatchSize: positiveNumber().default(50),
```

### 3. GraphTallyCollector Modifications
**File:** `packages/indexer-common/src/allocations/graph-tally-collector.ts`

#### 3.1 Add batch size to constructor/create

Extract `ravCollectionMaxBatchSize` from `networkSpecification.indexerOptions` in `create()` method (~line 139).

Store as class property:
```typescript
private readonly ravCollectionMaxBatchSize: number
```

#### 3.2 Add pre-validation method

New method to validate a single RAV via `estimateGas`:

```typescript
private async validateRavForCollection(
  rav: SignedRAVv2,
): Promise<{ valid: boolean; encodedData?: string; error?: string }>
```

- Encodes the collect call data
- Calls `SubgraphService.collect.estimateGas()`
- Returns `{ valid: true, encodedData }` on success
- Returns `{ valid: false, error }` on failure

#### 3.3 Modify submitRAVs() method (lines 666-748)

Replace the one-by-one loop with batched processing.

**Important**: Escrow balance checks must remain **sequential** to prevent race conditions. If we validate escrow in parallel, two RAVs for 10 GRT each could both pass validation against a 10 GRT escrow, then the batch would fail on-chain.

```typescript
private async submitRAVs(signedRavs: RavWithAllocation[]): Promise<void> {
  const logger = this.logger.child({ function: 'submitRAVs' })

  // 1. Get escrow balances (same as current implementation)
  const escrowAccounts = await getEscrowAccounts(
    this.networkSubgraph,
    this.indexerAddress,
    logger,
  )

  // 2. SEQUENTIAL: Pre-filter by escrow balance
  //    We must track in-memory balance as we "reserve" escrow for each RAV
  //    This prevents race conditions where multiple RAVs pass validation
  //    against the same escrow balance
  const escrowApprovedRavs: RavWithAllocation[] = []

  for (const ravWithAllocation of signedRavs) {
    const { rav, payer } = ravWithAllocation
    const signedRav = rav.getSignedRAV()
    const ravValue = BigInt(signedRav.rav.valueAggregate)

    const escrowAccount = escrowAccounts[payer]
    if (!escrowAccount) {
      logger.warn('No escrow account found for payer', { payer })
      continue
    }

    const tokensAlreadyCollected = escrowAccount.totalCollected
    const payerBalance = escrowAccount.balance
    const tokensToCollect = ravValue - tokensAlreadyCollected

    if (payerBalance >= tokensToCollect) {
      escrowApprovedRavs.push(ravWithAllocation)
      // Decrement in-memory balance to "reserve" it for this RAV
      escrowAccount.balance -= tokensToCollect
    } else {
      logger.warn('Skipping RAV: insufficient escrow balance', {
        payer,
        payerBalance: formatGRT(payerBalance),
        tokensToCollect: formatGRT(tokensToCollect),
      })
    }
  }

  if (escrowApprovedRavs.length === 0) {
    logger.debug('No RAVs passed escrow balance check')
    return
  }

  // 3. PARALLEL: Validate on-chain via estimateGas
  //    This catches issues like: already redeemed, invalid signature, etc.
  const validationResults = await Promise.all(
    escrowApprovedRavs.map(async (ravWithAllocation) => {
      const { rav, allocation, payer } = ravWithAllocation
      const signedRav = rav.getSignedRAV()
      const result = await this.validateRavForCollection(signedRav)
      return { rav, allocation, payer, signedRav, ...result }
    })
  )

  // 4. Filter to valid RAVs only
  const validRavs = validationResults.filter(r => r.valid)

  if (validRavs.length === 0) {
    logger.debug('No RAVs passed on-chain validation')
    return
  }

  logger.info('Submitting RAVs in batches', {
    totalValid: validRavs.length,
    batchSize: this.ravCollectionMaxBatchSize,
    batchCount: Math.ceil(validRavs.length / this.ravCollectionMaxBatchSize),
  })

  // 5. Chunk into batches of ravCollectionMaxBatchSize
  const batches = chunk(validRavs, this.ravCollectionMaxBatchSize)

  // 6. Process each batch
  for (const batch of batches) {
    await this.redeemRavBatch(logger, batch)
  }
}
```

#### 3.4 Add new redeemRavBatch() method

```typescript
private async redeemRavBatch(
  logger: Logger,
  batch: ValidatedRav[],
): Promise<void> {
  // 1. Build multicall data array
  const callData = batch.map(r => r.encodedData)

  // 2. Execute multicall with estimateGas
  const txReceipt = await this.transactionManager.executeTransaction(
    () => this.contracts.SubgraphService.multicall.estimateGas(callData),
    (gasLimit) => this.contracts.SubgraphService.multicall(callData, { gasLimit }),
    logger.child({ function: 'multicall-collect' }),
  )

  // 3. Parse all PaymentCollected events from receipt (keyed by collectionId)
  const collectedByCollection = this.parsePaymentCollectedEvents(txReceipt)

  // 4. Mark each RAV as redeemed and update metrics
  for (const { rav } of batch) {
    const tokensCollected = collectedByCollection.get(rav.collectionId)

    if (tokensCollected !== undefined) {
      this.metrics.ravCollectedFees.set(
        { collection: rav.collectionId },
        parseFloat(tokensCollected.toString()),
      )
      await this.markRavAsRedeemed(rav.collectionId, rav.payer)
      this.metrics.ravRedeemsSuccess.inc({ collection: rav.collectionId })
    } else {
      logger.warn('PaymentCollected event not found for RAV', {
        collectionId: rav.collectionId,
      })
    }
  }
}
```

#### 3.5 Add event parsing helper

Note: `PaymentCollected` is emitted by `GraphTallyCollector` contract (not SubgraphService).

**TODO during implementation**: Verify `PaymentCollected` event fields from contract ABI. If it includes `collectionId`, use Map-based matching. Otherwise, fall back to order-based matching (multicall executes sequentially, so events are ordered).

```typescript
// Option A: If event has collectionId field (preferred)
private parsePaymentCollectedEvents(
  txReceipt: TransactionReceipt
): Map<string, bigint> {
  const contractInterface = this.contracts.GraphTallyCollector.interface
  const event = contractInterface.getEvent('PaymentCollected')
  const collectorAddress = this.contracts.GraphTallyCollector.target

  const collectedByCollection = new Map<string, bigint>()

  for (const log of txReceipt.logs) {
    // Filter by contract address AND event topic
    if (log.address === collectorAddress && log.topics[0] === event.topicHash) {
      const decoded = contractInterface.decodeEventLog(event, log.data, log.topics)
      collectedByCollection.set(decoded.collectionId, BigInt(decoded.tokens))
    }
  }

  return collectedByCollection
}

// Option B: If event lacks collectionId, use order-based matching
private parsePaymentCollectedEventsOrdered(
  txReceipt: TransactionReceipt
): bigint[] {
  const contractInterface = this.contracts.GraphTallyCollector.interface
  const event = contractInterface.getEvent('PaymentCollected')
  const collectorAddress = this.contracts.GraphTallyCollector.target

  return txReceipt.logs
    .filter(log => log.address === collectorAddress && log.topics[0] === event.topicHash)
    .map(log => {
      const decoded = contractInterface.decodeEventLog(event, log.data, log.topics)
      return BigInt(decoded.tokens)
    })
}
```

#### 3.6 Encode collect call data

Need to encode the full `collect()` call (not just the inner data) for multicall:

```typescript
private encodeCollectCall(signedRav: SignedRAVv2): string {
  const { rav, signature } = signedRav
  const encodedData = encodeCollectQueryFeesData(rav, hexlify(signature), 0n)

  return this.contracts.SubgraphService.interface.encodeFunctionData('collect', [
    rav.serviceProvider,
    PaymentTypes.QueryFee,
    encodedData,
  ])
}
```

---

## Implementation Order

1. Add CLI option and schema (`start.ts`, `network-specification.ts`)
2. Add `ravCollectionMaxBatchSize` property to GraphTallyCollector
3. Add `encodeCollectCall()` helper method
4. Add `validateRavForCollection()` method
5. Add `parsePaymentCollectedEvents()` helper
6. Add `redeemRavBatch()` method
7. Modify `submitRAVs()` to use batching
8. Keep existing `redeemRav()` method for backwards compatibility / fallback

---

## Edge Cases to Handle

1. **Empty batch after validation**: Skip multicall if no valid RAVs
2. **Partial batch failure**: If multicall `estimateGas` fails after individual validations passed (state changed), log error and skip batch (retry next cycle)
3. **Event count mismatch**: If number of `PaymentCollected` events doesn't match batch size, log error and handle gracefully
4. **Escrow balance race condition**: Prevented by sequential escrow balance checks with in-memory balance tracking. Each RAV "reserves" its portion of the escrow before being added to the validation queue. This ensures we never over-commit against a payer's escrow.

---

## Verification Plan

1. **Unit tests**: Add tests for new methods in `graph-tally-collector.test.ts`
   - Test `validateRavForCollection()` with mock contract
   - Test `parsePaymentCollectedEvents()` with mock receipt
   - Test `redeemRavBatch()` with mock multicall
   - Test batching logic (chunking, empty batches)

2. **Integration test**:
   - Run `scripts/run-tests.sh` to ensure existing tests pass
   - Test with mock SubgraphService contract that supports multicall

3. **Manual testing**:
   - Deploy to testnet with multiple pending RAVs
   - Verify batch transactions on block explorer
   - Check logs for correct batch sizes and event parsing

---

## Metrics

Existing metrics can be reused:
- `ravRedeemsSuccess` - increment per RAV in batch
- `ravRedeemsInvalid` - increment for failed validations
- `ravCollectedFees` - set per RAV with actual collected amount

Consider adding:
- `ravBatchSize` - histogram of batch sizes submitted
- `ravBatchesSubmitted` - counter of multicall transactions
