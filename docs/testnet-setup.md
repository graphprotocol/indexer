# Testnet indexer setup

The Graph Network's testnet is on Arbitrum Sepolia, and network information can be found at https://testnet.thegraph.com/explorer/network.

> See [networks/testnet.md](/networks/testnet.md) for the latest releases & configuration information.

### Registration / Funding (GRT)

In order to participate in the testnet, you'll need Sepolia ETH and GRT.
To be eligible for testnet GRT, you'll need to

1. join [The Graph Discord](https://thegraph.com/discord/),
2. get the `@testnetindexer` role in the `#roles` channel,
3. use the `#arbi-sepolia-faucet` channel to obtain testnet GRT.

### Approving And Staking

The Graph Network testnet is open for everyone to participate in as an
indexer. The only requirement is a minimum stake of 100k testnet GRT.

#### Via Graph Explorer

The Graph Explorer provides an easy way to approve and stake your GRT as an indexer via a web GUI. 

1. Navigate to [the testnet explorer](https://testnet.thegraph.com/)
2. Login with Metamask and select the `Arbitrum Sepolia` network
3. Navigate to your profile (click your address/avatar at top right)
4. Select the `Indexing` tab and hit the `Stake` button
5. Follow the directions on the staking screen to stake the desired amount 

### Via the Contracts CLI

To approve your testnet GRT to be spent through the staking contract, first approve
it in the GRT contract:

```bash
git clone https://github.com/graphprotocol/contracts
cd contracts

 # If you haven't done this before:
npm install
npm run compile

./cli/cli.ts -m <indexer-mnemonic> -p <arbitrum-sepolia-node> \
  contracts graphToken approve --account 0x35e3Cb6B317690d662160d5d02A5b364578F62c9 --amount <grt>
```

Afterwards, stake this amount:

```bash
./cli/cli.ts -m <indexer-mnemonic> -p <arbitrum-sepolia-node> \
  contracts staking stake --amount <grt>
```

### Setting An Operator

#### Via Graph Explorer

1. Navigate to [the testnet explorer](https://testnet.thegraph.com/)
2. Login with Metamask and select the `Arbitrum Sepolia` network
3. Navigate to your settings page (click profile dropdown at top right and select ⚙️ `Settings`)
4. Navigate to the `Operators` settings (click `Operators` button)
5. Click `+` to add your operator wallet address
6. Follow instructions to submit transaction

### Via the Contracts CLI

```bash
./cli/cli.ts -m <indexer-mnemonic> -p <arbitrum-sepolia-node> \
  contracts staking setOperator --operator <operator-address> --allowed true
```

You are now ready to set up your testnet indexer, visit [networks/arbitrum-sepolia.md](/networks/arbitrum-sepolia.md) for configuration information.
