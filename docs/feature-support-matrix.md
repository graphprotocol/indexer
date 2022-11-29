# Feature support matrix

As described in [GIP-0008](https://snapshot.org/#/council.graphprotocol.eth/proposal/0xbdd884654a393620a7e8665b4289201b7542c3ee62becfad133e951b0c408444), this defines indexing & querying features which are experimental or not fully supported for indexing & query rewards and arbitration.

Each deployment of The Graph Network has its own specific Feature support matrix, as features will be introduced to testnet & mainnet at different stages of the development and testing lifecycle.

An example:

| Subgraph Feature         | Aliases | Implemented | Experimental | Query Arbitration | Indexing Arbitration | Indexing Rewards |
|--------------------------|---------|-------------|--------------|-------------------|----------------------|------------------|
| **Core Features**        |         |             |              |                   |                      |                  |
| Full-text Search         |         | Yes         | No           | No                | Yes                  | Yes              |
| Non-Fatal Errors         |         | Yes         | Yes          | Yes               | Yes                  | Yes              |
| Grafting                 |         | Yes         | Yes          | Yes               | Yes                  | Yes              |
| **Data Source Types**    |         |             |              |                   |                      |                  |
| eip155:*                 | *       | Yes         | No           | No                | No                   | No               |
| eip155:1                 | mainnet | Yes         | No           | Yes               | Yes                  | Yes              |
| eip155:100               | gnosis  | Yes         | No           | Yes               | Yes                  | Yes              |
| near:*                   | *       | Yes         | Yes          | No                | No                   | No               |
| cosmos:*                 | *       | Yes         | Yes          | No                | No                   | No               |
| arweave:*                | *       | Yes         | Yes          | No                | No                   | No               |
| **Data Source Features** |         |             |              |                   |                      |                  |
| ipfs.cat in mappings     |         | Yes         | Yes          | No                | No                   | No               |
| ENS                      |         | Yes         | Yes          | No                | No                   | No               |


- Aliases can be used in subgraph manifest files to refer to specific networks.
- Experimental features are generally not fully supported for indexing rewards and arbitration, and usage of experimental features will be considered during any arbitration that does occur.
- Query fees apply to all queries, regardless of the underlying features used by a subgraph.
- Subgraph features not named in the matrix are assumed to be fully supported for indexing & query rewards and arbitration