
# Graph Horizon provision management

## Glossary

- **indexer stake**: all of the tokens that have been staked by the indexer
- **idle stake**: indexer's stake that has not been assigned to a provision and it's not part of legacy allocations
- **provisioned stake**: stake that has been assigned to a provision
- **delegated stake**: stake that has been delegated to a specific (indexer, provision). Pre-horizon delegation is automatically credited to the `SubgraphService` provision.
- **available stake**: stake that is available within the provision to be used, for example for allocations. Note that this will include provisioned tokens plus delegated stake.

[](./images/provision.png)

## Provision creation for the Subgraph Service
`indexer-agent` will perform the initial creation of the provision. This is attempted _only_ when the agent starts up and _only_ if the indexer's idle stake is greater than 100k GRT, that is:

```
idle stake > 100k GRT
indexer stake - legacy allocated stake > 100k GRT
```

For the provision to be created the agent needs to be configured with a max initial provision size, this can be done by:
- setting env var `INDEXER_AGENT_MAX_PROVISION_INITIAL_SIZE=100000`
- via config file:
    ```
    indexerOptions:
        maxProvisionInitialSize: 100000
    ```

## Provision management

There are three basic operations on a provision:
- `provision()/addToProvision()`: adding idle stake to a provision.
- `thaw()`: thawing available stake from a provision.
- `deprovision()`: removing thawed stake from a provision back into the idle stake pool.

These actions can be executed via indexer-cli or Graph Explorer. We recommend using the cli since it's more versatile.
Note that it's still required to `stake()` and `unstake()` to get stake into/out from the protocol.


### Provision management: Graph Explorer

- When staking through Graph Explorer the added stake will automatically be provisioned to the Subgraph Service (if the provision exists).
- When unstaking/withdrawing through Graph Explorer stake will automatically be thawed and deprovisioned from the provision.

### Provision management: indexer-cli

`indexer-cli` provides a much more flexible way to manage your provision:
    
```jsx
$ graph indexer provision --help
Manage indexer's provision

    indexer provision thaw         Thaw stake from the indexer's provision
    indexer provision remove       Remove thawed stake from the indexer's provision
    indexer provision list-thaw    List thaw requests for the indexer's provision
    indexer provision get          List indexer provision details
    indexer provision add          Add stake to the indexer's provision
    indexer provision              Manage indexer's provision
```
    
**Get provision details**
        
```jsx
$ graph indexer --network hardhat provision get
✔ Provisions
┌────────────────────────────────────────────┬─────────────────┬───────────────────┬─────────────────┬───────────────┬────────────────┬───────────────┐
│ dataService                                │ protocolNetwork │ tokensProvisioned │ tokensAllocated │ tokensThawing │ maxVerifierCut │ thawingPeriod │
├────────────────────────────────────────────┼─────────────────┼───────────────────┼─────────────────┼───────────────┼────────────────┼───────────────┤
│ 0x0a17fabea4633ce714f1fa4a2dca62c3bac4758d │ hardhat         │ 100,000.0         │ 0.01            │ 0.0           │ 50.0           │ 7200          │
└────────────────────────────────────────────┴─────────────────┴───────────────────┴─────────────────┴───────────────┴────────────────┴───────────────┘

Indexer's idle stake: 100,000.0 GRT
To add this stake to the Subgraph Service provision, run 'graph indexer provision add <amount>'
```
        
**Add stake to the provision**
        
```jsx
$ graph indexer --network hardhat provision add 100000
✔ Stake added to the provision
┌────────────────────────────────────────────┬─────────────────┬───────────────────┐
│ dataService                                │ protocolNetwork │ tokensProvisioned │
├────────────────────────────────────────────┼─────────────────┼───────────────────┤
│ 0x0a17fabea4633ce714f1fa4a2dca62c3bac4758d │ hardhat         │ 200,000.0         │
└────────────────────────────────────────────┴─────────────────┴───────────────────┘
        ```
        
**Thaw stake from the provision**
        
Note that multiple thaws can be going on simultaneously.

```jsx
$ graph indexer --network hardhat provision thaw 50000
✔ Stake thawed from the provision
┌────────────────────────────────────────────┬─────────────────┬───────────────┬───────────────┬────────────────────────┐
│ dataService                                │ protocolNetwork │ tokensThawing │ thawingPeriod │ thawingUntil           │
├────────────────────────────────────────────┼─────────────────┼───────────────┼───────────────┼────────────────────────┤
│ 0x0a17fabea4633ce714f1fa4a2dca62c3bac4758d │ hardhat         │ 50,000.0      │ 7200          │ 9/18/2025, 10:08:58 PM │
└────────────────────────────────────────────┴─────────────────┴───────────────┴───────────────┴────────────────────────┘
```
        
**List ongoing thaw requests**
        
This will also show any thawings initiated via Graph Explorer

```jsx
$ graph indexer --network hardhat provision list-thaw
✔ Got thaw requests
┌────────────────────────────────────────────────────────────────────┬───────────┬─────────────────┬──────────┬────────────────────────┐
│ id                                                                 │ fulfilled │ protocolNetwork │ shares   │ thawingUntil           │
├────────────────────────────────────────────────────────────────────┼───────────┼─────────────────┼──────────┼────────────────────────┤
│ 0x26b448afdeb7b9b7552ec5aa774b692871f808b80616d9d3e150c4576597acff │ false     │ hardhat         │ 50,000.0 │ 9/18/2025, 10:08:58 PM │
├────────────────────────────────────────────────────────────────────┼───────────┼─────────────────┼──────────┼────────────────────────┤
│ 0x87f978a42c77a4c525d781f00fdef0225507317c7c5a34018ae166a7243ee80b │ false     │ hardhat         │ 12,345.0 │ 9/18/2025, 10:11:15 PM │
├────────────────────────────────────────────────────────────────────┼───────────┼─────────────────┼──────────┼────────────────────────┤
│ 0x920f5c0eee54e4741f99cabc6f0142a6c3502f62e430d880762c6489c6ac1c23 │ false     │ hardhat         │ 1,337.0  │ 9/18/2025, 10:12:40 PM │
└────────────────────────────────────────────────────────────────────┴───────────┴─────────────────┴──────────┴────────────────────────┘

Latest block timestamp: 9/18/2025, 8:12:40 PM
```
        
**Remove thawed stake**
        
This puts the stake into the indexer’s “idle stake” pool

```jsx
$ graph indexer --network hardhat provision remove
✔ Thawed stake removed from the provision
┌────────────────────────────────────────────┬─────────────────┬───────────────────┬───────────────┐
│ dataService                                │ protocolNetwork │ tokensProvisioned │ tokensThawing │
├────────────────────────────────────────────┼─────────────────┼───────────────────┼───────────────┤
│ 0x0a17fabea4633ce714f1fa4a2dca62c3bac4758d │ hardhat         │ 200,000.0         │ 0.0           │
└────────────────────────────────────────────┴─────────────────┴───────────────────┴───────────────┘

Removed 63,682.0 GRT from the provision
```