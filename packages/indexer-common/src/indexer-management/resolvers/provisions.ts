import { Network } from '@graphprotocol/indexer-common'
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import gql from 'graphql-tag'

import {
  IndexerManagementResolverContext,
} from '@graphprotocol/indexer-common'
import { extractNetwork } from './utils'

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
}
