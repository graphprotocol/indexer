import pMap from 'p-map'
import { Wallet } from 'ethers'
import { NativeAttestationSigner } from '@graphprotocol/indexer-native'

import { Logger, Eventual } from '@graphprotocol/common-ts'

import { LRUCache } from '@thi.ng/cache'
import {
  Allocation,
  allocationSignerPrivateKey,
  indexerError,
  IndexerErrorCode,
} from '@graphprotocol/indexer-common'

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
    maxlen: 10000,
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
          const signerPK = allocationSignerPrivateKey(wallet, allocation)
          const nativeSigner = new NativeAttestationSigner(
            chainId,
            disputeManagerAddress,
            signerPK,
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
    const attestationSigners = [...signers.keys()]
    logger.info(`Cached ${attestationSigners.length} attestation signers`, {
      allocations: attestationSigners,
    })
  })

  return signers
}
