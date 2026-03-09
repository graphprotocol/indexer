# Direct Commands

Direct commands execute allocation operations immediately on the blockchain, bypassing the action queue and the reconciliation loop. Use these when you need instant execution without waiting for the queue cycle.

**Note:** Rules only drive automatic allocation decisions in **AUTO** and **OVERSIGHT** modes. In **MANUAL** mode, the reconciliation loop is skipped entirely.

## Commands

### Get Allocations

View current allocations:

```bash
graph indexer allocations get --network <network>
graph indexer allocations get --status active --network <network>
graph indexer allocations get --status closed --network <network>
graph indexer allocations get --allocation <allocation-id> --network <network>
```

Options:
- `-n, --network` - Protocol network (mainnet, arbitrum-one, sepolia, arbitrum-sepolia) **required**
- `--status` - Filter by status: `active` or `closed`
- `--allocation` - Get a specific allocation by ID
- `-o, --output` - Output format: `table` (default), `json`, or `yaml`

### Create Allocation

Open a new allocation to a subgraph deployment:

```bash
graph indexer allocations create <deployment-id> <amount> [index-node] --network <network>
```

Arguments:
- `deployment-id` - Subgraph deployment ID (bytes32 or IPFS hash)
- `amount` - Amount of GRT to allocate
- `index-node` - (optional) Specific index node to use

Options:
- `-n, --network` - Protocol network **required**
- `-o, --output` - Output format

Example:
```bash
graph indexer allocations create QmXa1b2c3d4e5f... 10000 --network arbitrum-one
```

### Close Allocation

Close an existing allocation:

```bash
graph indexer allocations close <allocation-id> [poi] [block-number] [public-poi] --network <network>
```

Arguments:
- `allocation-id` - The allocation ID to close
- `poi` - (optional) Proof of indexing
- `block-number` - (optional, Horizon only) Block number the POI was computed at
- `public-poi` - (optional, Horizon only) Public POI at the same block height

Options:
- `-n, --network` - Protocol network **required**
- `-f, --force` - Bypass POI accuracy checks
- `-o, --output` - Output format

Example:
```bash
graph indexer allocations close 0x1234...abcd --network arbitrum-one
graph indexer allocations close 0x1234...abcd 0xpoi... --force --network arbitrum-one
```

### Reallocate

Atomically close an allocation and open a new one:

```bash
graph indexer allocations reallocate <allocation-id> <amount> [poi] [block-number] [public-poi] --network <network>
```

Arguments:
- `allocation-id` - The allocation to close
- `amount` - Amount of GRT for the new allocation
- `poi` - (optional) Proof of indexing
- `block-number` - (optional, Horizon only) Block number
- `public-poi` - (optional, Horizon only) Public POI

Options:
- `-n, --network` - Protocol network **required**
- `-f, --force` - Bypass POI accuracy checks
- `-o, --output` - Output format

Example:
```bash
graph indexer allocations reallocate 0x1234...abcd 15000 --network arbitrum-one
```

### Present POI (Horizon Only)

Collect indexing rewards by presenting a POI without closing the allocation:

```bash
graph indexer allocations present-poi <allocation-id> [poi] [block-number] [public-poi] --network <network>
```

Arguments:
- `allocation-id` - The allocation
- `poi` - (optional) Proof of indexing
- `block-number` - (optional) Block number the POI was computed at
- `public-poi` - (optional) Public POI

Options:
- `-n, --network` - Protocol network **required**
- `-f, --force` - Bypass POI accuracy checks
- `-o, --output` - Output format

Example:
```bash
graph indexer allocations present-poi 0x1234...abcd --network arbitrum-one
```

### Resize (Horizon Only)

Change the allocated stake without closing the allocation:

```bash
graph indexer allocations resize <allocation-id> <amount> --network <network>
```

Arguments:
- `allocation-id` - The allocation to resize
- `amount` - New allocation amount

Options:
- `-n, --network` - Protocol network **required**
- `-o, --output` - Output format

Example:
```bash
graph indexer allocations resize 0x1234...abcd 20000 --network arbitrum-one
```

### Collect Query Fees

Trigger query fee collection for an allocation:

```bash
graph indexer allocations collect <allocation-id> --network <network>
```
