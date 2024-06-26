import gql from 'graphql-tag'

export const SCHEMA_SDL = gql`
  type IndexingAgreement {
    signature: String!
    data: String!
    protocolNetwork: String!
  }

  type IndexingPrice {
    pricePerBlock: Float!
    chainId: String!
    protocolNetwork: String!
  }

  type Query {
    agreement(signature: String!): IndexingAgreement
    price(protocolNetwork: String!, chainId: String!): IndexingPrice
    prices: [IndexingPrice]
  }

  type Mutation {
    createIndexingAgreement(signature: String!, data: String!): IndexingAgreement
    cancelIndexingAgreement(signature: String!): IndexingAgreement
    createPrice(
      pricePerBlock: Float!
      protocolNetwork: String!
      chainId: String!
    ): IndexingPrice
    removePrice(priceId: Int!): IndexingPrice
  }
`
