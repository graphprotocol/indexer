/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { Network } from '../../network'
import { IndexerManagementResolverContext } from '../client'
import {
  AgreementState,
  fetchIndexingAgreements,
  IndexingAgreementDetails,
} from '../../indexing-fees/agreement-monitor'

interface IndexingAgreementFilter {
  status?: AgreementState | null
  agreementId?: string | null
  protocolNetwork?: string | null
}

type IndexingAgreementInfo = IndexingAgreementDetails & { protocolNetwork: string }

export default {
  indexingAgreements: async (
    { filter }: { filter: IndexingAgreementFilter },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<IndexingAgreementInfo[]> => {
    logger.debug('Execute indexingAgreements() query', { filter })
    if (!multiNetworks) {
      throw Error('IndexerManagementClient must be in `network` mode to fetch agreements')
    }

    const agreementsByNetwork = await multiNetworks.map(
      async (network: Network): Promise<IndexingAgreementInfo[]> => {
        const protocolNetwork = network.specification.networkIdentifier
        if (filter.protocolNetwork && filter.protocolNetwork !== protocolNetwork) {
          return []
        }

        const subgraph = network.indexingPaymentsSubgraph
        if (!subgraph) {
          throw Error(
            `Network '${protocolNetwork}' has no indexing-payments subgraph configured`,
          )
        }

        const agreements = await fetchIndexingAgreements(
          subgraph,
          network.specification.indexerOptions.address,
          {
            state: filter.status ?? undefined,
            id: filter.agreementId ?? undefined,
          },
        )

        return agreements.map((agreement) => ({ ...agreement, protocolNetwork }))
      },
    )

    return Object.values(agreementsByNetwork).flat()
  },
}
