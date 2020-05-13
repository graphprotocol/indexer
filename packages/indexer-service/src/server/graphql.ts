import graphqlHTTP from 'express-graphql'
import { buildASTSchema } from 'graphql'
import gql from 'graphql-tag'
import axios from 'axios'

export interface GraphQLServerOptions {
  graphNodeStatusEndpoint: string
}

interface ProofOfIndexingArgs {
  subgraph: string
  blockNumber: string
}

const SCHEMA = gql`
  scalar BigInt
  scalar Bytes

  type Query {
    proofOfIndexing(subgraph: String!, blockNumber: BigInt!): Bytes
  }
`

export const createGraphQLServer = ({
  graphNodeStatusEndpoint,
}: GraphQLServerOptions) => {
  let schema = buildASTSchema(SCHEMA)

  let client = axios.create({
    baseURL: graphNodeStatusEndpoint,
    headers: { 'Content-Type': 'application/json' },
  })

  let Query = {
    proofOfIndexing: async (args: ProofOfIndexingArgs) => {
      // Forward proof of indexing queries to the configured
      // graph-node status endpoint
      let response = await client.post('', {
        query: `
          {
            proofOfIndexing(
              subgraph: "${args.subgraph}",
              blockNumber: "${args.blockNumber}"
            )
          }
        `,
      })
      return response.data.data.proofOfIndexing
    },
  }

  return graphqlHTTP({
    schema,
    graphiql: true,
    rootValue: Query,
  })
}
