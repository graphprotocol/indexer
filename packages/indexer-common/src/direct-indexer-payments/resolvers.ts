import gql from 'graphql-tag'
import { IndexerManagementClient } from '../indexer-management'
import { IndexingAgreementData } from './models'

export default {
  Query: {
    prices: async (parent, args, client: IndexerManagementClient) => {
      return client.query(gql`
        query {
          prices {
            price
            chainId
            protocolNetwork
          }
        }
      `)
    },

    price: async (
      parent,
      chainAndProtocolNetwork: {
        chainId: string
        protocolNetwork: string
      },
      client: IndexerManagementClient,
    ) => {
      return client.query(
        gql`
          query {
            price(chainId: "$chainId", protocolNetwork: "$protocolNetwork") {
              pricePerBlock
              chainId
              protocolNetwork
            }
          }
        `,
        chainAndProtocolNetwork,
      )
    },
    agreement: async (parent, { signature }, client: IndexerManagementClient) => {
      return client.query(
        gql`
          query {
            agreement(signature: "$signature") {
              signature
              data
            }
          }
        `,
        { signature },
      )
    },
  },

  Mutation: {
    createIndexingAgreement: async (
      parent,
      agreement: IndexingAgreementData,
      client: IndexerManagementClient,
    ) => {
      return client.mutation(
        gql`
        mutation {
          createIndexingAgreement(signature: "$signature", data: "$data") {
            signature
            data
          }
      `,
        agreement,
      )
    },

    cancelIndexingAgreement: async (
      parent,
      hasSignature: { signature: string },
      client: IndexerManagementClient,
    ) => {
      return client.mutation(
        gql`
          mutation {
            cancelIndexingAgreement(signature: "$signature") {
              signature
            }
          }
        `,
        hasSignature,
      )
    },
  },
}
