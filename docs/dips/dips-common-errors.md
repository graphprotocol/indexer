# DIPS: common errors

Failure modes the indexer may see when running DIPS, what they mean, and how to resolve them. For an overview of how DIPS works see the [main guide](./dips-indexer-guide.md); for config and CLI actions see the [quick reference](./dips-quick-reference.md).

> ⚠️ Most DIPS failures the agent encounters during `accept` and `collect` are **deterministic contract errors**. The agent does not cancel agreements on these — it throttles retries and keeps trying on the next cycle, so transient causes recover automatically. Persistent failures need investigation.

## `RecurringCollectorExcessiveSlippage`

```
RecurringCollectorExcessiveSlippage(tokens, tokensToCollect, maxSlippage)
```

- **Where it comes from.** `RecurringCollector._collect` in the Horizon contracts, raised during `SubgraphService.collect`.
- **What it means.** The data-service request (`collectionSeconds × (tokensPerSecond + tokensPerEntityPerSecond × entities)`) exceeded the agreement's per-collection cap (`maxOngoingTokensPerSecond × collectionSeconds`, plus `maxInitialTokens` on the first collection) by more tokens than the indexer's slippage tolerance allowed.
- **What to do.**
  - The deployment's per-entity rate × current entity count may have grown past what the payer agreed to pay per second. If the workload genuinely changed, the payer's RCA needs new terms.
  - If the gap is small and expected, raise `--dips-collection-slippage`. Default is `1`% — try `5` if collections regularly revert here.

## `PaymentsEscrowInsufficientBalance`

```
PaymentsEscrowInsufficientBalance(balance, tokens)
```

- **Where it comes from.** `PaymentsEscrow.collect` in the Horizon contracts, after the slippage check passes.
- **What it means.** The payer's escrow account doesn't hold enough GRT to cover the post-cap `tokensToCollect`.
- **What to do.** No agent-side fix. The payer must top up their escrow before collection can succeed. The agent throttles retries; once funds return, collection picks up on the next cycle. Time keeps ticking against `maxSecondsPerCollection`, so a long shortage means lost seconds beyond the cap.

## `RecurringCollectorAgreementNotCollectable`

```
RecurringCollectorAgreementNotCollectable(agreementId, reason)
```

- **Where it comes from.** `RecurringCollector._collect`, before the slippage check.
- **What it means.** The agreement is in a state that doesn't allow collection — most often because it isn't yet inside its collection window (`minSecondsPerCollection` hasn't elapsed) or it has been cancelled. The `reason` field disambiguates.
- **What to do.** Usually nothing — the agent's collection tracker shouldn't request a collection before the window opens; if it does, the next cycle catches up. Persistent occurrences point to clock skew between the indexer host and chain, or a stale view from the indexing-payments subgraph.

## `RecurringCollectorUnauthorizedDataService`

```
RecurringCollectorUnauthorizedDataService(dataService)
```

- **Where it comes from.** `RecurringCollector._collect`.
- **What it means.** The service provider (the indexer's address) doesn't have an active provision in the SubgraphService at the time of collection. The check prevents an attack where a malicious payer drains escrow through a fake data-service, and as a side effect it blocks legitimate collection if the provision is missing.
- **What to do.** Restore the SubgraphService provision (`graph indexer provision add ...`) and the agent will succeed on the next cycle.

## Agent skips a collection: `paused` / `unauthorized`

The agent's transaction manager runs a pre-flight check before each `collect`. If the network is paused or the agent's signer isn't authorized to act on the indexer, the agent logs `Cannot collect: network paused or unauthorized` and skips that collection. It does not mark the collection attempted, so the next cycle retries immediately once the condition clears.

## Proposal stays pending: `not_yet`

The agent logs `Offer not yet on subgraph; leaving proposal pending`. The indexing-payments subgraph hasn't seen the on-chain `offer` entity for this agreement yet. Almost always transient subgraph lag. Persistent occurrences mean the subgraph isn't progressing — check that the indexing-payments subgraph is healthy and synced.

## Proposal rejected: `offer_hash_mismatch`

The on-chain `offerHash` for the agreement doesn't match the RCA hash the agent computed from the proposal payload. The agent marks the proposal `rejected` and removes the DIPS rule if no other proposals reference the same deployment. Indicates a producer/consumer disagreement upstream — investigate Dipper-side proposal generation. The agent will not retry this proposal.

## Proposal rejected: `deadline_expired`

The agent picked up a proposal whose `deadline` was already past. Marked `rejected` and the DIPS rule is cleaned up. Most often caused by the proposal sitting too long in the queue — possible if the agent was stopped, or if `--dips-acceptance-interval` was much longer than the proposal's deadline. Default is `5`s, which is fine.

## Indexing-payments subgraph stale — rule cleanup skipped

The agent logs `Skipping DIPS rule cleanup: indexing-payments subgraph is stale or unreadable`. The agent checks the indexing-payments subgraph's latest indexed block; if it lags chain head by more than 5 minutes, the DIPS rule reaper is skipped for that cycle so it can't wrongly delete rules for agreements that are actually live (the agent treats a stale subgraph as "list of agreements is incomplete"). Acceptance and collection are unaffected; only rule cleanup pauses.

- **What to do.** Check that the indexing-payments subgraph is healthy and progressing. If it's a hosted endpoint, confirm the provider is up; if it's indexed locally, look at Graph Node sync status for the deployment. Once the subgraph catches up, the next reconciliation cycle resumes normal rule cleanup automatically.

## Agent log: `Could not get POI for agreement, using zero POI`

The agent couldn't fetch a POI from Graph Node for the recent block it picked. It proceeds with a zero POI; the contract accepts it and the collection still settles. Disputable, however — sustained occurrences point to the deployment not being indexed or being behind chain head. Confirm the deployment is healthy in Graph Node.
