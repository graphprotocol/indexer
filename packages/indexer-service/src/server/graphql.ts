import graphqlHTTP from 'express-graphql'
import { buildASTSchema } from 'graphql'
import gql from 'graphql-tag'
import axios from 'axios'

export interface GraphQLServerOptions {
  graphNodeStatusEndpoint: string
}

const SCHEMA = gql`
  type Query {
    foo: String!
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
    foo: () => 'bar',
  }

  return graphqlHTTP({
    schema,
    graphiql: true,
    rootValue: Query,
  })
}
