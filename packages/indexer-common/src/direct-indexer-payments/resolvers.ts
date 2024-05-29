import gql from 'graphql-tag'
import { IndexerManagementClient } from '../indexer-management'
import { IndexingAgreementData } from './models'

export default {
  Query: {
    prices: async (parent, args, client: IndexerManagementClient) => {
      return client.query(gql`
        query {
          prices {
            subgraphDeploymentID
            price
            protocolNetwork
          }
        }
      `)
    },

    price: async (
      parent,
      {
        subgraphDeploymentId,
        protocolNetwork,
      }: {
        subgraphDeploymentId: string
        protocolNetwork: string
      },
      client: IndexerManagementClient,
    ) => {
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
    agreement: async (parent, { signature }, client: IndexerManagementClient) => {
      return client.query(gql`
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
      agreement: IndexingAgreementData,
      client: IndexerManagementClient,
    ) => {
      return client.mutation(gql`
        mutation {
          createIndexingAgreement(signature: "${agreement.signature}", data: "${agreement.data}") {
            signature
            data
          }
      `)
    },

    cancelIndexingAgreement: async (
      parent,
      { signature }: { signature: string },
      client: IndexerManagementClient,
    ) => {
      return client.mutation(gql`
        mutation {
          cancelIndexingAgreement(signature: "${signature}") {
            signature
          }
        }
      `)
    },
  },
}
