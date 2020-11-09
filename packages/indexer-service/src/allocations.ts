import gql from 'graphql-tag'
import pMap from 'p-map'
import { Wallet } from 'ethers'
import { Client } from '@urql/core'

import { Logger, Eventual, timer, Address } from '@graphprotocol/common-ts'

import { LRUCache } from '@thi.ng/cache'
import {
  Allocation,
  allocationSigner,
  parseGraphQLAllocation,
} from '@graphprotocol/indexer-common'

export interface MonitorActiveAllocationsOptions {
  indexer: Address
  logger: Logger
  networkSubgraph: Client
  interval: number
}

export const monitorActiveAllocations = ({
  indexer,
  logger: parentLogger,
  networkSubgraph,
  interval,
}: MonitorActiveAllocationsOptions): Eventual<Allocation[]> => {
  const logger = parentLogger.child({ component: 'AllocationMonitor' })

  const refreshAllocations = async (
    currentAllocations: Allocation[],
  ): Promise<Allocation[]> => {
    logger.debug('Refresh active allocations')

    try {
      const result = await networkSubgraph
        .query(
          gql`
            query allocations($indexer: String!) {
              indexer(id: $indexer) {
                allocations(
                  where: { status: Active }
                  orderDirection: desc
                  first: 1000
                ) {
                  id
                  allocatedTokens
                  createdAtBlockHash
                  createdAtEpoch
                  closedAtEpoch
                  subgraphDeployment {
                    id
                    stakedTokens
                    signalAmount
                  }
                }
              }
            }
          `,
          {
            indexer: indexer.toLowerCase(),
          },
        )
        .toPromise()

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
      return result.data.indexer.allocations.map(parseGraphQLAllocation)
    } catch (err) {
      logger.warn(`Failed to query allocations, keeping existing`, {
        allocations: currentAllocations.map(allocation => allocation.id),
        err,
      })
      return currentAllocations
    }
  }

  const allocations = timer(interval).reduce(refreshAllocations, [])

  allocations.pipe(allocations => {
    logger.info(`Active allocations`, {
      allocations: allocations.map(allocation => ({
        allocation: allocation.id,
        deployment: allocation.subgraphDeployment.id.display,
      })),
    })
  })

  return allocations
}

export interface EnsureAttestationSignersOptions {
  logger: Logger
  allocations: Eventual<Allocation[]>
  wallet: Wallet
}

export type AttestationSignerCache = LRUCache<string, string>
export type AttestationSignerMap = Map<string, string>

const cacheToMap = (cache: LRUCache<string, string>): AttestationSignerMap =>
  new Map([...cache.entries()].map(([k, v]) => [k, v.v]))

export const ensureAttestationSigners = ({
  logger: parentLogger,
  allocations,
  wallet,
}: EnsureAttestationSignersOptions): Eventual<AttestationSignerMap> => {
  const logger = parentLogger.child({ component: 'AttestationSignerCache' })

  const cache: AttestationSignerCache = new LRUCache(null, {
    ksize: (k: string) => k.length,
    vsize: (v: string) => v.length,
    maxsize: 10000,
  })

  const signers = allocations.map(async allocations => {
    logger.info(`Updating attestation signers`)

    await pMap(allocations, async allocation => {
      if (!cache.has(allocation.id)) {
        try {
          logger.info(`Identify attestation signer for allocation`, {
            allocation: allocation.id,
            deployment: allocation.subgraphDeployment.id.display,
          })

          // Derive an epoch and subgraph specific private key
          const signer = allocationSigner(wallet, allocation)

          logger.info(`Successfully identified attestation signer for allocation`, {
            allocation: allocation.id,
            deployment: allocation.subgraphDeployment.id.display,
          })

          // Update the cache
          cache.set(allocation.id, signer)
        } catch (err) {
          logger.warn(`Failed to identify attestation signer for allocation`, {
            allocation: allocation.id,
            deployment: allocation.subgraphDeployment.id.display,
            createdAtEpoch: allocation.createdAtEpoch,
            err,
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
