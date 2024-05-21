import gql from 'graphql-tag'

export const SCHEMA_SDL = gql`
  type IndexingAgreement {
    signature: String!
    data: String!
    protocolNetwork: String!
  }

  type IndexingPrice {
    subgraphDeploymentID: String!
    price: Float!
    protocolNetwork: String!
  }

  type Query {
    agreement(signature: String!): IndexingAgreement
    price(subgraphDeploymentID: String!, protocolNetwork: String!): IndexingPrice
  }

  type Mutation {
    createIndexingAgreement(signature: String!, data: String!): IndexingAgreement
  }
`
