import gql from 'graphql-tag'
import { IndexerManagementClient } from '../indexer-management'
import { Logger } from '@graphprotocol/common-ts'

// import { extractNetwork } from '../indexer-management/resolvers/utils'
// import { MultiNetworks } from '../multi-networks'
// import { Network } from '../network'
// import { networkIdentifier } from '../parsers/basic-types'
export interface IndexingPaymentResolverContext {
  logger: Logger
  // multiNetworks: MultiNetworks<Network> | undefined
  client: IndexerManagementClient
}

export interface CreateAgreementArgs {
  signature: string
  data: string
}

export default {
  // Prices are created from the cli and indicate participation in indexing-payments on the part of the indexer
  // Therefore no hypothetical 'createIndexingPrice' mutation is needed or desirable.

  Query: {
    price: async (
      parent,
      {
        subgraphDeploymentId,
        protocolNetwork,
      }: {
        subgraphDeploymentId: string
        protocolNetwork: string
      },
      {
        logger,
        // multiNetworks,
        client,
      }: IndexingPaymentResolverContext,
    ) => {
      logger.debug('Querying price for subgraph deployment', {
        subgraphDeploymentId,
        protocolNetwork,
      })

      // if (!multiNetworks) {
      //   throw new Error('Multi-networks not initialized')
      // }

      // const network = extractNetwork(protocolNetwork, multiNetworks)
      const networkIdTODO = protocolNetwork
      return client.query(gql`
            query {
              price(subgraphDeploymentID: "${subgraphDeploymentId}", protocolNetwork: "${
                // network.specification.networkIdentifier
                networkIdTODO
              }") {
                subgraphDeploymentID
                pricePerBlock
                protocolNetwork
              }
            }
         `)
    },
    agreement: async (parent, { signature }, context: IndexingPaymentResolverContext) => {
      return context.client.query(gql`
            query {
              agreement(signature: "${signature}") {
                signature
                data
              }
            }
          `)
    },
  },

  Mutation: {
    createIndexingAgreement: async (
      parent,
      args: CreateAgreementArgs,
      context: IndexingPaymentResolverContext,
    ) => {
      return context.client.mutation(gql`
            mutation {
              createIndexingAgreement(signature: "${args.signature}", data: "${args.data}") {
                signature
                data
              }
          `)
    },
  },
}
