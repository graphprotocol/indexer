# DIPS: quick reference

Configuration and day-to-day actions for DIPS, in one place. For concepts and procedural walkthroughs see the [main guide](./dips-indexer-guide.md); for failure modes see [common errors](./dips-common-errors.md).

Each option has an environment variable equivalent: prefix `INDEXER_AGENT_`, uppercase, dashes → underscores. For example `--enable-dips` → `INDEXER_AGENT_ENABLE_DIPS`, `--rav-check-interval` → `INDEXER_AGENT_RAV_CHECK_INTERVAL`.

## DIPS options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--enable-dips` | boolean | `false` | Master switch for DIPS. When `true`, the agent reconciles DIPS rules, accepts pending proposals on-chain, and periodically collects payments. |
| `--indexing-payments-subgraph-endpoint` | string | — | Query URL for the indexing-payments subgraph. One of `endpoint` or `deployment` is required when DIPS is enabled. |
| `--indexing-payments-subgraph-deployment` | string | — | Deployment ID of the indexing-payments subgraph, for local hosting. One of `endpoint` or `deployment` is required when DIPS is enabled. |
| `--dips-allocation-amount` | number (GRT) | `0` | GRT used when opening an allocation for a DIPS deployment whose subgraph **doesn't earn indexing rewards**. For reward-earning deployments the agent uses the deployment's indexing-rule `allocationAmount` (or `defaultAllocationAmount`). A zero allocation is valid for DIPS because collection pays the RCA-agreed amount and is independent of allocation size. |
| `--dips-collection-target` | number (1–90) | `50` | Where inside the agreement's collection window the agent aims to collect, as a percentage. `1` collects as close to `minSecondsPerCollection` as possible (more transactions, earlier payout); `90` collects close to `maxSecondsPerCollection` (fewer transactions, more in-flight earnings). See [Tuning](./dips-indexer-guide.md#tuning). |
| `--dips-collection-slippage` | number (0–100) | `1` | Maximum slippage the agent will accept on a single collection, as a percentage of the data-service request. If a collection would exceed it, the transaction reverts and the agent throttles retries. See [Tuning](./dips-indexer-guide.md#tuning). |
| `--dips-acceptance-interval` | number (seconds) | `5` | How often the DIPS proposal-acceptance loop runs. Determines how quickly a freshly-received proposal is accepted on-chain after the indexer-service queues it. |

## Long-lived collection options

These options are not DIPS-specific — they govern the long-lived-allocation collection model that DIPS relies on (and that applies to other allocations too). See [Collecting without closing](./dips-indexer-guide.md#collecting-without-closing).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--rav-check-interval` | number (seconds) | `900` | How often the RAV processing loop runs. |
| `--rav-collection-interval` | number (seconds) | `14400` | Minimum time between periodic RAV collections per active allocation. Lower values collect more often (more gas, earlier payout); higher values collect less often. |
| `--rav-collection-max-batch-size` | number | `50` | Maximum number of RAVs collected in a single multicall transaction. |

## List agreements

Use the indexer-cli to inspect DIPS agreements known to the indexer-agent:

```bash
graph indexer dips agreements get [options]
graph indexer dips agreements get [options] <agreement-id>
graph indexer dips agreements get [options] all
```

Options:

- `-n, --network <network>` — filter by protocol network (e.g. `arbitrum-one`).
- `--status <state>` — filter by agreement state: `Accepted`, `CanceledByPayer`, `CanceledByServiceProvider`, `NotAccepted`.
- `--deployment <id>` — filter by subgraph deployment.
- `-o, --output table|json|yaml` — output format (default `table`).
- `-w, --wrap [N]` — wrap output to width `N`.

Each row reports: `id`, `payer`, `indexer`, `allocationId`, `subgraphDeploymentId`, `state`, `acceptedAt`, `lastCollectionAt`, `endsAt`, `tokensPerSecond`, `tokensCollected`, `canceledAt`, `canceledBy`, `protocolNetwork`.

## Decline or cancel an agreement

To refuse a deployment outright, or to cancel an agreement already active for it, set a `never` rule for the deployment:

```bash
graph indexer rules stop <deployment-id>   # 'never' is an alias for 'stop'
```

On the next cycle the indexer-agent runs a best-effort final collection and cancels the agreement on-chain. An `offchain` rule has the same effect. See [Declining a deployment (opt out)](./dips-indexer-guide.md#declining-a-deployment-opt-out).

## Close an allocation

```bash
graph indexer allocations close <id> <poi> <blockNumber> <publicPOI>
```

When the deployment has an active DIPS agreement, this is rejected — the allocation is protected so the agreement can keep collecting. To force the close anyway, pass `--force`:

```bash
graph indexer allocations close <id> <poi> <blockNumber> <publicPOI> --force
```

> ⚠️ A force-close cancels the DIPS agreement on-chain as part of the same transaction (the `SubgraphService` contract auto-cancels active agreements when the backing allocation is closed). Use it only when the intent is to stop fulfilling the agreement entirely; for an orderly opt-out, prefer setting a `never` rule, which runs a best-effort final collection first.
