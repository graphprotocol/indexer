# Feature support matrix

As described in [GIP-0008](https://snapshot.org/#/council.graphprotocol.eth/proposal/0xbdd884654a393620a7e8665b4289201b7542c3ee62becfad133e951b0c408444), the Feature support matrix defines indexing & querying features which are experimental or not fully supported for indexing & query rewards and arbitration.

The matrix below reflects the canonical Council-ratified version. As outlined in GIP-00008, Council ratification is currently required for each update, which may happen at different stages of feature development and testing lifecycle.

| Subgraph Feature           | Aliases       | Implemented | Experimental | Query Arbitration | Indexing Arbitration | Indexing Rewards |
| -------------------------- | ------------- | ----------- | ------------ | ----------------- | -------------------- | ---------------- |
| **Core Features**          |               |             |              |                   |                      |                  |
| Full-text Search           |               | Yes         | No           | No                | Yes                  | Yes              |
| Non-Fatal Errors           |               | Yes         | Yes          | Yes               | Yes                  | Yes              |
| Grafting                   |               | Yes         | Yes          | Yes               | Yes                  | Yes              |
| **Data Source Types**      |               |             |              |                   |                      |                  |
| eip155:\*                  | \*            | Yes         | No           | No                | No                   | No               |
| eip155:1                   | mainnet       | Yes         | No           | Yes               | Yes                  | Yes              |
| eip155:100                 | gnosis        | Yes         | Yes          | Yes               | Yes                  | Yes              |
| near:\*                    | \*            | Yes         | Yes          | No                | No                   | No               |
| cosmos:\*                  | \*            | Yes         | Yes          | No                | No                   | No               |
| arweave:\*                 | \*            | Yes         | Yes          | No                | No                   | No               |
| eip155:42161               | artbitrum-one | Yes         | Yes          | Yes               | Yes                  | Yes              |
| eip155:42220               | celo          | Yes         | Yes          | Yes               | Yes                  | Yes              |
| eip155:43114               | avalanche     | Yes         | Yes          | Yes               | Yes                  | Yes              |
| eip155:250                 | fantom        | Yes         | Yes          | Yes               | Yes                  | Yes              |
| eip155:137                 | polygon       | Yes         | Yes          | Yes               | Yes                  | Yes              |
| eip155:10                  | optimism      | Yes         | Yes          | Yes               | Yes                  | Yes              |
| **Data Source Features**   |               |             |              |                   |                      |                  |
| ipfs.cat in mappings       |               | Yes         | Yes          | No                | No                   | No               |
| ENS                        |               | Yes         | Yes          | Yes               | Yes                  | Yes              |
| File data sources: Arweave |               | Yes         | Yes          | No                | Yes                  | Yes              |
| File data sources: IPFS    |               | Yes         | Yes          | No                | Yes                  | Yes              |
| Substreams: mainnet        |               | Yes         | Yes          | Yes               | Yes                  | Yes              |
| Substreams: optimism       |               | Yes         | Yes          | Yes               | Yes                  | Yes              |

The accepted `graph-node` version range must always be specified; it always comprises the latest available version and the one immediately preceding it.
The latest for the feature matrix above:

```
graph-node: >=0.35.0 <0.36.0
```

### Latest Council snapshot

[GGP-0040: Updated Feature Support (ens, arweave, 0.35.x)](https://snapshot.org/#/council.graphprotocol.eth/proposal/0x214ad88959a8e09e7341b21650699ab67345493d9386118dc524c827bd011090)

### Other notes

- Currently, one single matrix is used to reflect protocol behaviour for both Ethereum mainnet and Arbitrum One.
- Aliases can be used in subgraph manifest files to refer to specific networks.
- Experimental features are generally not fully supported for indexing rewards and arbitration, and usage of experimental features will be considered during any arbitration that does occur.
- Query fees apply to all queries, regardless of the underlying features used by a subgraph.
- Subgraph features not named in the matrix are assumed to be fully supported for indexing & query rewards and arbitration
