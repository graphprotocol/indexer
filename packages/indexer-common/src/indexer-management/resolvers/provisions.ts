import { indexerError, IndexerErrorCode, Network } from '@graphprotocol/indexer-common'
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import gql from 'graphql-tag'

import {
  IndexerManagementResolverContext,
} from '@graphprotocol/indexer-common'
import { extractNetwork } from './utils'
import { formatGRT, parseGRT } from '@graphprotocol/common-ts'

enum ProvisionQuery {
  all = 'all',
}

interface ProvisionInfo {
  id: string
  dataService: string
  indexer: string
  tokensProvisioned: string
  tokensAllocated: string
  tokensThawing: string
  maxVerifierCut: string
  thawingPeriod: string
  protocolNetwork: string
}

interface AddToProvisionResult {
  id: string
  dataService: string
  indexer: string
  tokensProvisioned: string
  tokensAllocated: string
  tokensThawing: string
  maxVerifierCut: string
  thawingPeriod: string
  protocolNetwork: string
}


const PROVISION_QUERIES = {
  // No need to paginate, there can only be one provision per (indexer, dataService) pair
  [ProvisionQuery.all]: gql`
    query provisions($indexer: String!, $dataService: String!) {
      provisions(
        where: { 
          indexer: $indexer,
          dataService: $dataService
        }
        orderBy: id
        orderDirection: asc
        first: 1000
      ) {
        id
        indexer {
          id
        }
        dataService {
          id
        }
        tokensProvisioned
        tokensAllocated
        tokensThawing
        thawingPeriod
        maxVerifierCut
      }
    }
  `,
}

export default {
  provisions: async (
    {
      protocolNetwork,
    }: {
      protocolNetwork: string
    },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<ProvisionInfo[]> => {
    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to fetch provisions',
      )
    }
    const network = extractNetwork(protocolNetwork, multiNetworks)
    const indexer = network.specification.indexerOptions.address.toLowerCase()
    const dataService = network.contracts.SubgraphService.target.toString().toLowerCase()

    logger.debug('Execute provisions() query', {
      indexer,
      dataService,
    })

    const provisionsByNetwork = await multiNetworks.map(
      async (network: Network): Promise<ProvisionInfo[]> => {
        // Return early if a different protocol network is specifically requested
        if (
          protocolNetwork &&
          protocolNetwork !== network.specification.networkIdentifier
        ) {
          return []
        }

        const { networkSubgraph } = network

        logger.trace('Query Provisions', {
          indexer,
          dataService,
        })

        const result = await networkSubgraph.checkedQuery(
          PROVISION_QUERIES.all,
          {
            indexer,
            dataService,
          },
        )

        if (result.error) {
          logger.error('Querying provisions failed', {
            error: result.error,
          })
        }

        return result.data.provisions.map(provision => ({
          id: provision.id,
          dataService,
          indexer,
          tokensProvisioned: provision.tokensProvisioned,
          tokensAllocated: provision.tokensAllocated,
          tokensThawing: provision.tokensThawing,
          maxVerifierCut: provision.maxVerifierCut,
          thawingPeriod: provision.thawingPeriod,
          protocolNetwork: network.specification.networkIdentifier,
        }))
      },
    )

    return Object.values(provisionsByNetwork).flat()
  },
  addToProvision: async (
    {
      protocolNetwork,
      amount,
    }: {
      protocolNetwork: string
      amount: string
    },
    {
      multiNetworks,
      logger,
    }: IndexerManagementResolverContext,
  ): Promise<AddToProvisionResult> => {
    logger.debug('Execute addToProvision() mutation', {
      amount,
    })

    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to add stake to a provision',
      )
    }

    const network = extractNetwork(protocolNetwork, multiNetworks)
    const networkMonitor = network.networkMonitor
    const contracts = network.contracts
    const transactionManager = network.transactionManager

    const indexer = network.specification.indexerOptions.address.toLowerCase()
    const dataService = contracts.SubgraphService.target.toString().toLowerCase()
    const provisionAmount = parseGRT(amount)


    if (provisionAmount < 0n) {
      logger.warn('Cannot add a negative amount of GRT', {
        amount: formatGRT(provisionAmount),
      })
      throw indexerError(
        IndexerErrorCode.IE079,
        `Invalid stake amount provided (${amount.toString()}). Must use positive stake amount`,
      )
    }

    try {
      // Check if the provision exists - this will throw if it doesn't
      const provision = await networkMonitor.provision(indexer, dataService)

      logger.debug('Provision found', { 
        provision,
      })

      logger.debug(`Sending addToProvision transaction`, {
        indexer: indexer,
        dataService: dataService,
        amount: formatGRT(provisionAmount),
        protocolNetwork,
      })

      const receipt = await transactionManager.executeTransaction(
        async () =>
          contracts.HorizonStaking.addToProvision.estimateGas(
            indexer,
            dataService,
            provisionAmount,
          ),
        async (gasLimit) =>
          contracts.HorizonStaking.addToProvision(
            indexer,
            dataService,
            provisionAmount,
            { gasLimit },
          ),
        logger.child({ action: 'addToProvision' }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        throw indexerError(
          IndexerErrorCode.IE062,
          `Allocation not created. ${
            receipt === 'paused' ? 'Network paused' : 'Operator not authorized'
          }`,
        )
      }

      const addToProvisionEventLogs = network.transactionManager.findEvent(
        'ProvisionIncreased',
        network.contracts.HorizonStaking.interface,
        'tokens',
        provisionAmount.toString(),
        receipt,
        logger,
      )

      if (!addToProvisionEventLogs) {
        throw indexerError(
          IndexerErrorCode.IE080,
          `Add to provision transaction was never mined`,
        )
      }

      logger.info(`Successfully added stake to provision`, {
        amountGRT: formatGRT(addToProvisionEventLogs.tokens),
        transaction: receipt.hash,
      })

      logger.debug('Provision increased', {
        provision,
      })

      return {
        id: provision.id,
        dataService,
        indexer,
        tokensProvisioned: (provision.tokensProvisioned + provisionAmount).toString(), // TODO: we could re-fetch the provision instead
        tokensAllocated: provision.tokensAllocated.toString(),
        tokensThawing: provision.tokensThawing.toString(),
        maxVerifierCut: provision.maxVerifierCut.toString(),
        thawingPeriod: provision.thawingPeriod.toString(),
        protocolNetwork: network.specification.networkIdentifier,
      }
    } catch (error) {
      logger.error('Failed to add stake to provision', {
        amount: formatGRT(provisionAmount),
        error,
      })
      throw error
    }
  }
}
