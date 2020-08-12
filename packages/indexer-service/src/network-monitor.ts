import gql from 'graphql-tag'
import { Evt } from 'evt'
import {
  Logger,
  createNetworkSubgraphClient,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import { Wallet } from 'ethers'
import { Allocation } from './types'

export interface AllocationsUpdatedEvent {
  added: Allocation[]
  removed: Allocation[]
  unchanged: Allocation[]
}

const allocationInList = (allocations: Allocation[], needle: Allocation): boolean =>
  allocations.find((allocation) => allocation.id === needle.id) !== undefined

export interface NetworkMonitorOptions {
  logger: Logger
  wallet: Wallet
  graphNode: string
  networkSubgraphDeployment: SubgraphDeploymentID
}

export class NetworkMonitor {
  logger: Logger
  allocationsUpdated: Evt<AllocationsUpdatedEvent>
  allocations: Allocation[]

  constructor(options: NetworkMonitorOptions) {
    this.logger = options.logger.child({ component: 'NetworkMonitor' })
    this.allocationsUpdated = Evt.create<AllocationsUpdatedEvent>()
    this.allocations = []
    this.periodicallySyncAllocations(options)
  }

  async periodicallySyncAllocations({
    logger,
    wallet,
    networkSubgraphDeployment,
    graphNode,
  }: NetworkMonitorOptions): Promise<never> {
    const url = new URL(`/subgraphs/id/${networkSubgraphDeployment.ipfsHash}`, graphNode)
    const client = await createNetworkSubgraphClient({
      url: url.toString(),
    })

    const indexerAddress = wallet.address.toLowerCase()

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        // Query graph-node for indexing subgraph versions
        const result = await client
          .query(
            gql`
              query indexedSubgraphs($id: ID!) {
                indexer(id: $id) {
                  allocations(where: { status: Active }) {
                    id
                    publicKey
                    subgraphDeployment {
                      id
                    }
                    createdAtEpoch
                  }
                }
              }
            `,
            { id: indexerAddress },
            {
              requestPolicy: 'network-only',
            },
          )
          .toPromise()

        if (result.error) {
          throw new Error(
            `Failed to query data for indexer '${indexerAddress}': ${result.error}`,
          )
        }

        if (!result.data || !result.data.indexer) {
          throw new Error(`Indexer '${indexerAddress}' has not registered itself yet`)
        }

        // Extract the allocations
        const allocations: Allocation[] = result.data.indexer.allocations.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ({ id, publicKey, subgraphDeployment, createdAtEpoch }: any) => ({
            id,
            publicKey,
            subgraphDeploymentID: new SubgraphDeploymentID(subgraphDeployment.id),
            createdAtEpoch,
          }),
        )

        // Identify allocation changes
        const removed = this.allocations.filter(
          (allocation) => !allocationInList(allocations, allocation),
        )
        const added = allocations.filter(
          (newAllocation) => !allocationInList(this.allocations, newAllocation),
        )
        const unchanged = this.allocations.filter((allocation) =>
          allocationInList(allocations, allocation),
        )

        // Update allocations
        this.allocations = allocations

        // Emit the update
        if (removed.length > 0 || added.length > 0) {
          logger.info('Syncing allocations with graph node', {
            url,
            indexerAddress,
            added,
            removed,
          })
          this.allocationsUpdated.post({ added, removed, unchanged })
        }
      } catch (error) {
        logger.warn(`Failed to query allocations`, { error: error.message })
      }

      // Wait 5s
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}
