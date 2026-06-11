# DIPS: indexer guide

> 💡 **DIPS (Direct Indexer Payments)** lets a payer commit to paying an indexer directly to keep a specific subgraph deployment indexed, under a recurring agreement arranged and settled on-chain.

## What is DIPS

With DIPS, a payer commits to paying an indexer over time to keep a subgraph deployment indexed, under an on-chain **Recurring Collection Agreement (RCA)**. Once the indexer-agent accepts an agreement, the indexer stack does the rest automatically: it opens an allocation for the deployment, keeps it indexed, and periodically collects the agreed payment on-chain through the Graph Horizon `SubgraphService` contract.

For all configuration options and day-to-day CLI actions, see the [quick reference](./dips-quick-reference.md).

## Core concepts

**Recurring Collection Agreement (RCA).** The on-chain agreement between a payer and an indexer. It defines who pays, for which deployment, the payment rate (a fixed amount per second, plus an optional amount per indexed entity per second), and the time bounds of the agreement. The RCA is the source of truth — collection happens against its terms through the `SubgraphService` and `RecurringCollector` contracts.

**Agreement lifecycle.** An agreement moves through a few states:
- **Proposed** — a payer has offered an agreement and it's waiting for the indexer-agent to accept.
- **Accepted** — the indexer-agent has accepted it on-chain; an allocation is open and indexing is underway.
- **Collecting** — at intervals, the indexer-agent collects the payment accrued so far.
- **Ended** — the agreement was cancelled (by the indexer or the payer) or reached its end time; collection stops.

**Long-lived allocations.** A DIPS agreement is backed by a long-lived allocation that doesn't expire. Payments are collected on-chain while the allocation remains open.

**Collection window.** Each agreement specifies a minimum and maximum time between collections. The indexer-agent collects somewhere inside that window; collecting earlier is safer (fees are banked sooner), collecting later means fewer transactions. Where in the window it aims is tunable (see [Tuning](#tuning)).

**Slippage protection.** The amount actually collected is the lower of the data-service request and the agreement's per-collection cap, so a collection can return less than the request. Slippage protection sets the largest gap an indexer will accept in a single collection.

## How an agreement reaches the indexer

Agreements arrive through the indexer stack:

1. A payer proposes an agreement on-chain. Its terms are delivered to the **indexer-service** through the Dipper.
2. The indexer-service validates the proposal — that it's addressed to the indexer, hasn't expired, targets a deployment the indexer can index, and meets the indexer's minimum price — and queues the valid ones for the agent.
3. The **indexer-agent** picks up the queued proposals, accepts the valid ones on-chain, and from then on keeps the deployment allocated and collects payments.

Enable DIPS and configure the stack (see [Enable DIPS](#enable-dips)); the accept-and-collect flow is automatic.

## What changes for the indexer

> 📢 What enabling DIPS changes about the indexer's operation, and what (if anything) the indexer needs to do.

| Area | How it works | Action required |
| --- | --- | --- |
| **New income stream** | Payers pay an indexer directly to index a deployment. | Enable DIPS to opt in. |
| **Receiving agreements** | Proposals are pushed to the indexer-service and queued for the agent. | Run indexer-service with its DIPS port reachable by the Dipper. |
| **Accepting agreements** | The agent verifies and accepts valid proposals on-chain. | None — automatic. |
| **Allocations** | Each accepted agreement is backed by a long-lived allocation that doesn't expire and isn't auto-closed. | Don't close it manually; `unallocate` is blocked unless forced. |
| **Indexing rules** | The agent creates a `dips` indexing rule per agreement deployment. | None. To refuse a deployment, set a `never` or `offchain` rule. |
| **Collecting payments** | The agent collects on-chain periodically within the agreement's window, with slippage protection. | None — tune with the `--dips-collection-*` options. |
| **Tracking agreements** | The agent reads agreement state from a new indexing-payments subgraph. | Configure the indexing-payments subgraph (see [Enable DIPS](#enable-dips)). |

## Enable DIPS

### Prerequisites

- A working Horizon indexer stack — DIPS settles through Horizon's `SubgraphService`.
- An **indexer-service** running with its DIPS port reachable by the Dipper, so proposals can be delivered.
- Access to the **indexing-payments subgraph** — either a query endpoint or a deployment ID to index locally.

### Configure the indexer-agent

Set the following options. Each has an `INDEXER_AGENT_`-prefixed environment variable (e.g. `--enable-dips` → `INDEXER_AGENT_ENABLE_DIPS`); see the [quick reference](./dips-quick-reference.md) for the full list.

| Option | Required | Default | Purpose |
| --- | --- | --- | --- |
| `--enable-dips` | yes | `false` | Turns DIPS on. |
| `--indexing-payments-subgraph-endpoint` | one of the two | — | Query URL for the indexing-payments subgraph. |
| `--indexing-payments-subgraph-deployment` | one of the two | — | Deployment ID to index and query the subgraph locally. |
| `--dips-allocation-amount` | no | `0` | GRT allocated for a DIPS deployment that earns no indexing rewards. |
| `--dips-collection-target` | no | `50` | Where in the collection window to collect, as a percentage (1–90). See [Tuning](#tuning). |
| `--dips-collection-slippage` | no | `1` | Maximum tolerated shortfall per collection, as a percentage (0–100). See [Tuning](#tuning). |
| `--dips-acceptance-interval` | no | `5` | Seconds between polls of the dedicated proposal-acceptance loop. |

At minimum, set `--enable-dips true` and one of the indexing-payments subgraph options. With DIPS enabled but no subgraph configured, the agent refuses to start.

### Restart and verify

1. Restart the indexer-agent with the new configuration. If `--indexing-payments-subgraph-deployment` is set, the agent indexes that deployment automatically; with `--indexing-payments-subgraph-endpoint` it queries the remote endpoint and indexes nothing locally.
2. Confirm DIPS is active in the agent logs — DIPS reconciliation appears each cycle, e.g. `Ensuring indexing rules for DIPs`.
3. Once an agreement is accepted, a `dips` indexing rule and an allocation appear for that deployment.

## Operation

Once enabled, DIPS work runs in two places:

- A **dedicated acceptance loop** polls for queued proposals every `--dips-acceptance-interval` seconds (default `5`). For each proposal it checks the deadline, verifies the on-chain offer, and accepts on-chain. If an allocation already exists for the deployment it is reused; otherwise the agent opens a new allocation and accepts in a single transaction.
- The **main reconciliation cycle** handles the rest:
  - **Ensures indexing rules** — creates a `dips` rule for every deployment with a pending proposal or active agreement, and removes rules for deployments no longer covered.
  - **Collects payments** — for each active agreement due within its collection window, it submits an on-chain collection with a recent-block POI and the deployment's entity count, applying the configured slippage limit.

All of this is automatic. The rest of this section covers the few things an indexer controls.

### Allocation management

When the agent accepts an agreement for a deployment with no existing allocation, it opens an allocation sized by whether the deployment earns indexing rewards:

- **Earns rewards** — the agent uses the configured allocation amount for the deployment (its indexing-rule `allocationAmount`, or the `defaultAllocationAmount`), so the allocation also earns indexing rewards.
- **No rewards** (rewards denied) — the agent uses `--dips-allocation-amount`.

A zero-token allocation is valid for DIPS: collection pays out the amount agreed in the RCA, and allocation size has no effect on the amount collected. For that reason `--dips-allocation-amount` defaults to `0`.

If an allocation already exists for the deployment, the agent reuses it.

### Collecting without closing

Under automatic allocation management, healthy allocations stay open and collect in place — the agent no longer closes and reopens them to get paid. DIPS agreements rely on this for their long-lived allocations, and it applies to other allocations too.

- **Indexing rewards** — once an allocation reaches the end of its configured lifetime, the agent presents a POI for it (a `PRESENT_POI` action) to collect accrued rewards and keeps the allocation open, repeating as needed.
- **Query fees** — collected periodically per active allocation by the RAV loop: `--rav-check-interval` sets how often the loop runs (default `900`s), and `--rav-collection-interval` the minimum time between collections per allocation (default `14400`s).

Because reallocation is no longer needed to collect, the `graph indexer allocations reallocate` command has been removed.

### Long-lived allocations are protected

A deployment under an active DIPS agreement is backed by an allocation the agent keeps open. To avoid accidentally breaking an agreement, the agent **rejects an `unallocate` action** for such a deployment unless `force` is passed. Closing the allocation prevents fulfilling the agreement, so do it only deliberately.

Protection lasts as long as the agreement is still on-chain collectable. For a payer-cancelled agreement the agent keeps protecting the allocation until the collection window is drained on-chain, then lets the allocation close through the normal lifecycle — so unpaid indexing stops on its own once there's nothing left to collect.

### Declining a deployment (opt out)

To decline a deployment, set a `never` rule for it:

```bash
graph indexer rules stop <deployment-id>   # 'never' is an alias for 'stop'
```

The agent then skips the deployment, and if an agreement is already active for it, runs a best-effort final collection and **cancels the agreement on-chain** on its next cycle. An `offchain` rule has the same opt-out effect.

> ⚠️ This is the agent-side control to refuse a deployment outright. It's separate from the indexer-service rejecting proposals priced below the indexer's minimum.

### What to monitor

- Agent logs for the DIPS work: rule reconciliation, proposal acceptance, and collections (including any throttled retries).
- Allocations for DIPS deployments, via the CLI or the network subgraph.
- Failed collections — a deterministic contract error throttles retries rather than cancelling, so persistent failures are worth investigating.
- Indexing-payments subgraph health — if it falls more than ~5 minutes behind chain head, the agent skips the DIPS rule reaper to avoid wrongly dropping rules for live agreements, and logs a warning (see [Common errors](./dips-common-errors.md#indexing-payments-subgraph-stale--rule-cleanup-skipped)).

## Tuning

Two options control how the agent collects DIPS payments.

### Collection target

`--dips-collection-target` (default `50`, range `1–90`) — a percentage that picks where inside the agreement's collection window the agent aims to collect. `0%` would mean as early as `minSecondsPerCollection`, `100%` as late as `maxSecondsPerCollection`; `50` lands in the middle.

### Slippage tolerance

For each collection, the contract computes two upper bounds:

- **Data-service request** — what the indexer claims is owed: `collectionSeconds × (tokensPerSecond + tokensPerEntityPerSecond × entities)`.
- **RCA payer cap** — what the agreement caps a single collection at: `maxOngoingTokensPerSecond × collectionSeconds` (plus `maxInitialTokens` on the first collection).

The payout is the lower of the two. The difference between the request and the payout is the **slippage** for that collection.

`--dips-collection-slippage` (default `1`, range `0–100`) — the maximum slippage the agent will accept on a single collection, as a percentage of the request. If a collection would exceed it, the transaction reverts and the agent throttles retries.
