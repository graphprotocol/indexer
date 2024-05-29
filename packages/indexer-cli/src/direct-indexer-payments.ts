import { IndexerManagementClient, IndexingPrice } from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'

export interface DirectIndexingPrice {
  subgraphDeploymentID: string
  price: number
  protocolNetwork: string
}

export const createPrice = async (
  price: IndexingPrice,
  client: IndexerManagementClient,
): Promise<IndexingPrice> => {
  const result = await client
    .mutation(
      gql`
    mutation {
      createPrice(subgraphDeploymentID: "${price.subgraphDeploymentId}", price: ${price.pricePerBlock}, protocolNetwork: "${price.protocolNetwork}") {
        subgraphDeploymentID
        price
        protocolNetwork
      }
    }
  `,
    )
    .toPromise()
  if (result.error) {
    throw result.error
  }
  return result.data.createPrice
}

export const removePrice = async (
  {
    subgraphDeploymentId,
    protocolNetwork,
  }: {
    subgraphDeploymentId: string
    protocolNetwork: string
  },
  client: IndexerManagementClient,
): Promise<void> => {
  const result = await client
    .mutation(
      gql`
      mutation {
        removePrice(subgraphDeploymentID: "${subgraphDeploymentId}", protocolNetwork: "${protocolNetwork}") {
          subgraphDeploymentID
          price
          protocolNetwork
        }
      }
  `,
    )
    .toPromise()
  if (result.error) {
    throw result.error
  }
  return result.data.createPrice
}
