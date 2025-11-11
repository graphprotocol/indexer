# Feature support matrix

As described in [GIP-0008](https://snapshot.org/#/council.graphprotocol.eth/proposal/0xbdd884654a393620a7e8665b4289201b7542c3ee62becfad133e951b0c408444), the Feature support matrix defines indexing & querying features which are experimental or not fully supported for indexing & query rewards and arbitration.

The matrix below reflects the canonical Council-ratified version. As outlined in GIP-00008, Council ratification is currently required for each update, which may happen at different stages of feature development and testing lifecycle.

| Subgraph Feature            | Aliases       | Implemented | Experimental | Query Arbitration | Indexing Arbitration | Indexing Rewards | Deprecated   |
| --------------------------- | ------------- | ----------- | ------------ | ----------------- | -------------------- | ---------------- | ------------ |
| **Core Features**           |               |             |              |                   |                      |                  |              |
| Full-text Search            |               | Yes         | No           | No                | Yes                  | Yes              |              |
| Non-Fatal Errors            |               | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| Grafting                    |               | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| **Data Source Types**       |               |             |              |                   |                      |                  |              |
| eip155:\*                   | \*            | Yes         | No           | No                | No                   | No               |              |
| eip155:1                    | mainnet       | Yes         | No           | Yes               | Yes                  | Yes              |              |
| eip155:100                  | gnosis        | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| near:\*                     | \*            | Yes         | Yes          | No                | No                   | No               |              |
| ~~arweave:\*~~ (deprecated) | \*            | Yes         | Yes          | No                | No                   | No               | v0.39.0      |
| eip155:42161                | arbitrum-one  | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:42220                | celo          | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:43114                | avalanche     | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:250                  | fantom        | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:137                  | polygon       | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:10                   | optimism      | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:8453                 | base          | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:534352               | scroll        | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:59144                | linea         | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:56                   | bsc           | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:7777777              | zora          | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:1284                 | moonbeam      | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:30                   | rootstock     | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:11155111             | sepolia       | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:97                   | chapel        | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| eip155:130                  | unichain      | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| **Data Source Features**    |               |             |              |                   |                      |                  |              |
| ipfs.cat in mappings        |               | Yes         | Yes          | No                | No                   | No               |              |
| ENS                         |               | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| File data sources: Arweave  |               | Yes         | Yes          | No                | Yes                  | Yes              |              |
| File data sources: IPFS     |               | Yes         | Yes          | No                | Yes                  | Yes              |              |
| Substreams: mainnet         |               | Yes         | Yes          | Yes               | Yes                  | Yes              |              |
| Substreams: optimism        |               | Yes         | Yes          | Yes               | Yes                  | Yes              |              |

Note: Items marked as deprecated are no longer supported in the specified version or later of `graph-node`.

The accepted `graph-node` version range must always be specified; it always comprises the latest available version and the one immediately preceding it.
The latest for the feature matrix above:

```
graph-node: >=0.38.0 <=0.39.1
```
### Other notes

- Currently, one single matrix is used to reflect protocol behaviour for both Ethereum mainnet and Arbitrum One.
- Aliases can be used in subgraph manifest files to refer to specific networks.
- Experimental features are generally not fully supported for indexing rewards and arbitration, and usage of experimental features will be considered during any arbitration that does occur.
- Query fees apply to all queries, regardless of the underlying features used by a subgraph.
- Subgraph features not named in the matrix are assumed to be fully supported for indexing & query rewards and arbitration
- [GGP-0057](https://snapshot.box/#/s:council.graphprotocol.eth/proposal/0x4eff14202f6204c0927860a9adff865fce33c32b6cbe7054227457631ee261b9) : Delegation of Chain Integration & Deprecation Authority to The Graph Foundation (with TAB Approval Requirement). 
This proposal delegates responsibility for approving new chain integrations (indexing rewards) and deprecating chains to The Graph Foundation, contingent upon receiving approval from the Technical Advisory Board (TAB). This change is intended to streamline operations while maintaining technical oversight. The Council retains override authority.
