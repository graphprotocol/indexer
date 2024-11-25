import { indexerError, IndexerErrorCode } from '@graphprotocol/indexer-common'
import { Allocation, MonitorEligibleAllocationsOptions } from './types'

import gql from 'graphql-tag'

import { Eventual, timer } from '@graphprotocol/common-ts'

export const monitorEligibleAllocations = ({
  indexer,
  logger: parentLogger,
  networkSubgraph,
  protocolNetwork,
  interval,
}: MonitorEligibleAllocationsOptions): Eventual<Allocation[]> => {
  const logger = parentLogger.child({ component: 'AllocationMonitor' })

  const refreshAllocations = async (
    currentAllocations: Allocation[],
  ): Promise<Allocation[]> => {
    logger.debug('Refresh eligible allocations', {
      protocolNetwork,
    })

    try {
      const currentEpochResult = await networkSubgraph.query(gql`
        query {
          graphNetwork(id: "1") {
            currentEpoch
          }
        }
      `)
      if (currentEpochResult.error) {
        throw currentEpochResult.error
      }

      if (
        !currentEpochResult.data ||
        !currentEpochResult.data.graphNetwork ||
        !currentEpochResult.data.graphNetwork.currentEpoch
      ) {
        throw new Error(`Failed to fetch current epoch from network subgraph`)
      }

      const currentEpoch = currentEpochResult.data.graphNetwork.currentEpoch

      const activeAllocations = await networkSubgraph.fetchActiveAllocations(indexer)
      const recentlyClosedAllocations =
        await networkSubgraph.fetchRecentlyClosedAllocations(indexer, currentEpoch)
      const allocations = [...activeAllocations, ...recentlyClosedAllocations]

      if (allocations.length == 0) {
        logger.warn(`No data / indexer not found on chain`, {
          allocations: [],
        })
      }

      return allocations
    } catch (err) {
      logger.warn(`Failed to query indexer allocations, keeping existing`, {
        allocations: currentAllocations.map((allocation) => allocation.id),
        err: indexerError(IndexerErrorCode.IE010, err),
      })
      return currentAllocations
    }
  }

  const allocations = timer(interval).reduce(refreshAllocations, [])

  allocations.pipe((allocations) => {
    logger.info(`Eligible allocations`, {
      allocations: allocations.map((allocation) => ({
        allocation: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
        closedAtEpoch: allocation.closedAtEpoch,
      })),
    })
  })

  return allocations
}
