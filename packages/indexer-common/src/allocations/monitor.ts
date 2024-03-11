import {
  indexerError,
  IndexerErrorCode,
  parseGraphQLAllocation,
} from '@graphprotocol/indexer-common'
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

      const result = await networkSubgraph.query(
        gql`
          query allocations($indexer: String!, $closedAtEpochThreshold: Int!) {
            indexer(id: $indexer) {
              activeAllocations: totalAllocations(
                where: { status: Active }
                orderDirection: desc
                first: 1000
              ) {
                id
                indexer {
                  id
                }
                allocatedTokens
                createdAtBlockHash
                createdAtEpoch
                closedAtEpoch
                subgraphDeployment {
                  id
                  stakedTokens
                  signalledTokens
                  queryFeesAmount
                }
              }
              recentlyClosedAllocations: totalAllocations(
                where: { status: Closed, closedAtEpoch_gte: $closedAtEpochThreshold }
                orderDirection: desc
                first: 1000
              ) {
                id
                indexer {
                  id
                }
                allocatedTokens
                createdAtBlockHash
                createdAtEpoch
                closedAtEpoch
                subgraphDeployment {
                  id
                  stakedTokens
                  signalledTokens
                  queryFeesAmount
                }
              }
            }
          }
        `,
        {
          indexer: indexer.toLowerCase(),
          closedAtEpochThreshold: currentEpoch - 1, // allocation can be closed within the last epoch or later
        },
      )

      if (result.error) {
        throw result.error
      }

      if (!result.data) {
        throw new Error(`No data / indexer not found on chain`)
      }

      if (!result.data.indexer) {
        throw new Error(`Indexer not found on chain`)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [
        ...result.data.indexer.activeAllocations,
        ...result.data.indexer.recentlyClosedAllocations,
      ].map((x) => parseGraphQLAllocation(x, protocolNetwork))
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
