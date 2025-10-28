# Feature Support Matrix

As described in [GIP-0008](https://snapshot.org/#/council.graphprotocol.eth/proposal/0xbdd884654a393620a7e8665b4289201b7542c3ee62becfad133e951b0c408444), the Feature Support Matrix defines indexing & querying features which are experimental or not fully supported for indexing & query rewards and arbitration.

---

## Governance

As of [GGP-0062](https://snapshot.org/#/s:council.graphprotocol.eth/proposal/0x4eff14202f6204c0927860a9adff865fce33c32b6cbe7054227457631ee261b9), the Feature Support Matrix is maintained by The Graph core protocol developers, and indexing rewards for networks are managed by The Graph Foundation (with review by the Technical Advisory Board).

### Responsibilities

**The Graph Foundation** (with TAB review):
- Adding or removing indexing rewards for networks
- Since indexing rewards determine arbitration support, this also controls which networks have arbitration enabled

**Core Protocol Developers**:
- Graph-node version requirements
- Core feature support and experimental status
- Data source feature support
- Technical implementation details

**Council Approval Required For**:
- Changes to arbitration eligibility for **existing features** or data sources
- Determining which **new features** or **new data source types** are eligible for indexing rewards
- Changes to arbitration policy that affect dispute resolution

**No Council Approval Required For**:
- Adding/removing networks with indexing rewards (Foundation + TAB authority)
- Adding new experimental features (not yet eligible for rewards)
- Graph-node version updates
- Documentation improvements and clarifications

---

## Graph Node Version Requirements

For arbitration to function fairly and consistently, indexers must run compatible versions of graph-node. As specified in the [Arbitration Charter (Section 10)](https://github.com/graphprotocol/graph-improvement-proposals/blob/main/gips/0009-arbitration-charter.md#10-subgraph-api-and-indexer-software-versioning), a defined version window ensures that:

1. **Consistent behavior**: All indexers subject to arbitration run compatible software
2. **Fair disputes**: Fishermen and indexers are evaluated against the same implementation
3. **Reasonable upgrade window**: Indexers have time to upgrade without being out of compliance

The accepted `graph-node` version range for indexers:

```
graph-node: >=0.38.0 <=0.39.1
```

**Policy**: This range must always comprise the latest available version and one immediately preceding it, providing indexers with a reasonable window to upgrade while ensuring the network runs on recent, well-tested software.

**Last Updated**: 2024-10-21

---

## Network Support & Arbitration

### Default Policy

**Networks with indexing rewards have full arbitration support (both query and indexing).**

This is a bidirectional relationship:
- **Indexing rewards enabled** → Arbitration support enabled
- **Arbitration support enabled** → Indexing rewards enabled

### How to Check Network Support

To verify if a network supports arbitration:

1. Check the [Networks Registry - Networks Table](https://github.com/graphprotocol/networks-registry/blob/main/docs/networks-table.md)
2. Look for ✅ in the **"Indexing Rewards"** column
3. If ✅ present → Network has full arbitration support
4. If no ✅ → Network does not have arbitration support

For complete network information (RPC endpoints, services, deprecation status, etc.), see the [Networks Registry](https://github.com/graphprotocol/networks-registry).

### Arbitration Policy Documentation

For detailed information about the arbitration policy and how it relates to indexing rewards, see [Network Arbitration Policy](https://github.com/graphprotocol/networks-registry/blob/main/docs/arbitration-policy.md).

### Exception Networks

Only networks that deviate from the default policy are listed here:

_Currently, all networks follow the default policy. This table will list exceptions if they arise._

| Network (CAIP-2) | Aliases | Query Arbitration | Indexing Arbitration | Notes |
| --- | --- | --- | --- | --- |
| | | | | |

---

## Core Subgraph Features

| Feature | Implemented | Experimental | Query Arbitration | Indexing Arbitration | Deprecated |
| --- | --- | --- | --- | --- | --- |
| Full-text Search | Yes | No | No | Yes | |
| Non-Fatal Errors | Yes | Yes | Yes | Yes | |
| Grafting | Yes | Yes | Yes | Yes | |

---

## Data Source Features

| Feature | Implemented | Experimental | Query Arbitration | Indexing Arbitration | Deprecated |
| --- | --- | --- | --- | --- | --- |
| ipfs.cat in mappings | Yes | Yes | No | No | |
| ENS | Yes | Yes | Yes | Yes | |
| File data sources: Arweave | Yes | Yes | No | Yes | |
| File data sources: IPFS | Yes | Yes | No | Yes | |
| Substreams: mainnet | Yes | Yes | Yes | Yes | |
| Substreams: optimism | Yes | Yes | Yes | Yes | |

---

## Deprecated Features and Networks

For information about deprecated networks and features, including which graph-node version deprecated them, see the [Networks Registry](https://github.com/graphprotocol/networks-registry).

Networks with a `deprecatedAt` timestamp in their `graphNode` section are no longer supported for subgraph deployments.

---

## Notes

- Currently, one single matrix reflects protocol behaviour for both Ethereum mainnet and Arbitrum One.
- Experimental features are generally not fully supported for indexing rewards and arbitration.
- Query fees apply to all queries, regardless of features used.
- Features not named in the matrix are assumed fully supported for indexing & query rewards and arbitration.
