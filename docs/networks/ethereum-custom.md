## Network Parameters

| Parameter                   | Value                         |
| --------------------------- |-------------------------------|
| Epoch length                | Being set in Network subgraph |
| Maximum allocation lifetime | ?                             |

### Indexer Agent

| Environment Variable                        | CLI Argument                    | Value                                                                             |
| ------------------------------------------- | ------------------------------- |-----------------------------------------------------------------------------------|
| `INDEXER_AGENT_ETHEREUM`                    | `--ethereum`                    | An Ethereum Goerli node/provider                                                  |
| `INDEXER_AGENT_ETHEREUM_NETWORK`            | `--ethereum-network`            | `mainnet-rpc-0` Being set up in the graph node                                    |
| `INDEXER_AGENT_INDEXER_ADDRESS`             | `--indexer-address`             | Ethereum address of testnet indexer                                               |
| `INDEXER_AGENT_INDEXER_GEO_COORDINATES`     | `--indexer-geo-coordinates`     | Geo coordinates of testnet indexer infrastructure                                 |
| `INDEXER_AGENT_MNEMONIC`                    | `--mnemonic`                    | Ethereum mnemonic for testnet operator                                            |
| `INDEXER_AGENT_NETWORK_SUBGRAPH_ENDPOINT`   | `--network-subgraph-endpoint`   | `https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-goerli`      |

In order to avoid collecting or claiming query fees below a certain threshold
(e.g. below the cost of the two transactions), the following configuration
option can be used. This needs to be tested on custom network

| Environment Variable                         | CLI Argument                      | Value                                                                                     |
| -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `INDEXER_AGENT_REBATE_CLAIM_THRESHOLD`       | `--rebate-claim-threshold`        | Minimum rebate (in GRT) received for an allocation to claim (Default: 200)                |
| `INDEXER_AGENT_REBATE_CLAIM_BATCH_THRESHOLD` | `--rebate-claim-batch-threshold`  | Minimum total rebates (in GRT) before a batched claim is processed (Default: 2000)        |
| `INDEXER_AGENT_VOUCHER_EXPIRATION`           | `--voucher-expiration`            | Time (in seconds) to permanently delete vouchers with too few query fees  (Default: 2160) |

### Indexer Service

| Environment Variable                         | CLI Argument                   | Value                                                                        |
|----------------------------------------------|--------------------------------|------------------------------------------------------------------------------|
| `INDEXER_SERVICE_ETHEREUM`                   | `--ethereum`                   | An Ethereum Goerli node/provider                                             |
| `INDEXER_SERVICE_ETHEREUM_NETWORK`           | `--ethereum-network`           | `mainnet-rpc-0` Being set up in the graph node                               |
| `INDEXER_SERVICE_INDEXER_ADDRESS`            | `--indexer-address`            | Ethereum address of testnet indexer                                          |
| `INDEXER_SERVICE_MNEMONIC`                   | `--mnemonic`                   | Ethereum mnemonic for testnet operator                                       |
| `INDEXER_SERVICE_NETWORK_SUBGRAPH_ENDPOINT`  | `--network-subgraph-endpoint`  | `https://api.thegraph.com/subgraphs/name/graphprotocol/graph-network-goerli` |
| `INDEXER_SERVICE_GRAPH_NODE_QUERY_ENDPOINT`  | `--graph-node-query-endpoint`  | `https://node.endpoint:8000`                                                 |
| `INDEXER_SERVICE_GRAPH_NODE_STATUS_ENDPOINT` | `--graph-node-status-endpoint` | `https://node.endpoint:8030/graphql`                                         |
| `INDEXER_SERVICE_GRAPH_NODE_ADMIN_ENDPOINT`  | `--graph-node-admin-endpoint`  | `https://node.endpoint:8020`                                                 |
| `INDEXER_SERVICE_POSTGRES_HOST`              |                                | `0.0.0.0`                                                                    |
| `INDEXER_SERVICE_POSTGRES_PORT`              |                                | `5432`                                                                       |
| `INDEXER_SERVICE_POSTGRES_USERNAME`          |                                | `postgres`                                                                   |
| `INDEXER_SERVICE_POSTGRES_PASSWORD`          |                                | `postgres`                                                                   |
| `INDEXER_SERVICE_POSTGRES_DATABASE`          |                                | `postgres`                                                                   |

### Graph Node

| Environment Variable | CLI Argument     | Value         |
| -------------------- | ---------------- |---------------|
| `ethereum`           | `--ethereum-rpc` | `mainnet:...` |
| `ipfs`               | `--ipfs`         | `...`         |


### Run the env
    
```bash
    yarn workspace @graphprotocol/indexer-service start
    yarn workspace @graphprotocol/indexer-agent start
```

### Create and publish a subgraph
## Deploy
1. Head to https://thegraph.com/studio/ and press “Create a subgraph”
2. Get contract address abi and “create” block number for ```graph init```
3. ```yarn codegen && yarn build```
4. Change package.json script with your node url
5. ```graph create --node [node_url]:8020 [subgraphName]```
6. ```yarn deploy```

## Publish
1. To publish subgraph on the network - the method [publishNewSubgraph](https://github.com/graphprotocol/contracts/blob/dev/contracts/discovery/GNS.sol#L247) from GNS.sol contract should be called with next params:
   1. bytes32 _subgraphDeploymentID
   2. bytes32 _versionMetadata
   3. bytes32 _subgraphMetadata
2. To get the _subgraphDeploymentID
   1. Get IPFS deployment CID e.g. QmNdiVkUQa4x9DdEHyR5k9z9oK4w41yNioDqizdimGyMPj and convert it to HEX
   2. replace 1220 with 0x (1220fe123->0xfe123)
3. Other parameters can be hardcoded with same string
4. After publishing the subgraph, find the transaction in the explorer, get into transaction logs and find the event `SubgraphPublished`. SubgraphID from that event is being used in the next step
5. Mint signal tokens for the subgraph
   1. Get the subgraph ID from the previous step
   2. Call the method [mintSignal](https://github.com/graphprotocol/contracts/blob/dev/contracts/discovery/GNS.sol#L390)

    
### Become an indexer

1. Approve Graph tokens to Staking contract
2. Stake at least 100k GRT via `stake` method of Staking contract
3. Set allocation rule via the CLI
```bash
graph-indexer indexer rules set <SUBGRAPH_IPFS_CID> allocationAmount 100000 decisionBasis always
```
4. Now Agent should send the allocation transaction. If it didn’t, you could try get actions list with ```graph-indexer indexer actions get``` and approve it via ```graph-indexer indexer actions approve {id}```
5. This should update `node` column in indexer deployments (you can get this info via ```graph-indexer indexer status```)
latestBlockNumber should be the same (or close to) with chainHeadBlockNumber

### Closing allocation and getting rewards
Rewards are based on the epochs age of allocation (epochs length is being set up during epoch contract initialisation)
1. Find allocation id ```graph-indexer indexer allocations get```
2. Close allocation ```graph-indexer indexer allocations close {id} -f``` (without -f it will fail bcz of queue receipts failure)
3. When an allocation is closed with a valid proof of indexing (POI) their indexing rewards are distributed to the Indexer
Rewards are going to be added to a deposit in the Staking contract
