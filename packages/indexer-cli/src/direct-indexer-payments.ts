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
          createPrice(
            pricePerBlock: $pricePerBlock
            protocolNetwork: "$protocolNetwork"
            chainId: "$chainId"
          ) {
            pricePerBlock
            chainId
            protocolNetwork
          }
        }
      `,
      price,
    )
    .toPromise()
  if (result.error) {
    throw result.error
  }
  return result.data.createPrice
}

export const removePrice = async (
  priceId: number,
  client: IndexerManagementClient,
): Promise<void> => {
  const result = await client
    .mutation(
      gql`
        mutation {
          removePrice(id: $priceId) {
            id
          }
        }
      `,
      { priceId },
    )
    .toPromise()
  if (result.error) {
    throw result.error
  }
  return result.data.createPrice
}
