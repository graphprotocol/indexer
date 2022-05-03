import gql from 'graphql-tag'
import pMap from 'p-map'
import { Wallet } from 'ethers'
import { NativeAttestationSigner } from '@graphprotocol/indexer-native'

import { Logger, Eventual, timer, Address } from '@graphprotocol/common-ts'

import { LRUCache } from '@thi.ng/cache'
import {
  Allocation,
  allocationSigner,
  indexerError,
  IndexerErrorCode,
  NetworkSubgraph,
  parseGraphQLAllocation,
} from '@graphprotocol/indexer-common'

export interface MonitorEligibleAllocationsOptions {
  indexer: Address
  logger: Logger
  networkSubgraph: NetworkSubgraph
  interval: number
}

export const monitorEligibleAllocations = ({
  indexer,
  logger: parentLogger,
  networkSubgraph,
  interval,
}: MonitorEligibleAllocationsOptions): Eventual<Allocation[]> => {
  const logger = parentLogger.child({ component: 'AllocationMonitor' })

  const refreshAllocations = async (
    currentAllocations: Allocation[],
  ): Promise<Allocation[]> => {
    logger.debug('Refresh eligible allocations')

    try {
      const currentEpochResult = await networkSubgraph.query(
        gql`
          query {
            graphNetwork(id: "1") {
              currentEpoch
            }
          }
        `,
      )
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
      ].map(parseGraphQLAllocation)
    } catch (err) {
      logger.warn(`Failed to query indexer allocations, keeping existing`, {
        allocations: currentAllocations.map(allocation => allocation.id),
        err: indexerError(IndexerErrorCode.IE010, err),
      })
      return currentAllocations
    }
  }

  const allocations = timer(interval).reduce(refreshAllocations, [])

  allocations.pipe(allocations => {
    logger.info(`Eligible allocations`, {
      allocations: allocations.map(allocation => ({
        allocation: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
        closedAtEpoch: allocation.closedAtEpoch,
      })),
    })
  })

  return allocations
}

export interface EnsureAttestationSignersOptions {
  logger: Logger
  allocations: Eventual<Allocation[]>
  wallet: Wallet
  chainId: number
  disputeManagerAddress: string
}

export type AttestationSignerCache = LRUCache<string, NativeAttestationSigner>
export type AttestationSignerMap = Map<string, NativeAttestationSigner>

const cacheToMap = (
  cache: LRUCache<string, NativeAttestationSigner>,
): AttestationSignerMap => new Map([...cache.entries()].map(([k, v]) => [k, v.v]))

export const ensureAttestationSigners = ({
  logger: parentLogger,
  allocations,
  wallet,
  chainId,
  disputeManagerAddress,
}: EnsureAttestationSignersOptions): Eventual<AttestationSignerMap> => {
  const logger = parentLogger.child({ component: 'AttestationSignerCache' })

  const cache: AttestationSignerCache = new LRUCache(null, {
    maxlen: 1000,
  })

  const signers = allocations.map(async allocations => {
    logger.info(`Update attestation signers`)

    await pMap(allocations, async allocation => {
      if (!cache.has(allocation.id)) {
        try {
          logger.info(`Identify attestation signer for allocation`, {
            allocation: allocation.id,
            deployment: allocation.subgraphDeployment.id.display,
          })

          // Derive an epoch and subgraph specific private key
          const signer = allocationSigner(wallet, allocation)
          const nativeSigner = new NativeAttestationSigner(
            chainId,
            disputeManagerAddress,
            signer,
            allocation.subgraphDeployment.id.bytes32,
          )

          logger.info(`Successfully identified attestation signer for allocation`, {
            allocation: allocation.id,
            deployment: allocation.subgraphDeployment.id.display,
          })

          // Update the cache
          cache.set(allocation.id, nativeSigner)
        } catch (err) {
          logger.warn(`Failed to identify attestation signer for allocation`, {
            allocation: allocation.id,
            deployment: allocation.subgraphDeployment.id.display,
            createdAtEpoch: allocation.createdAtEpoch,
            err: indexerError(IndexerErrorCode.IE022, err),
          })
        }
      }
    })

    return cacheToMap(cache)
  })

  signers.pipe(signers => {
    logger.info(`Cached attestation signers`, {
      allocations: [...signers.keys()],
    })
  })

  return signers
}
