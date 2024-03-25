import { extractNetwork } from  "../../../../indexer-management/resolvers/utils"
import type { QueryResolvers } from './../../../types.generated'
import gql from 'graphql-tag'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { IndexerErrorCode, indexerError } from "../../../../errors"

export const indexerAllocations: NonNullable<
  QueryResolvers['indexerAllocations']
> = async (_parent, { protocolNetwork }, { multiNetworks, logger }) => {
  if (!multiNetworks) {
    throw Error(
      'IndexerManagementClient must be in `network` mode to fetch indexer allocations',
    )
  }

  const network = extractNetwork(protocolNetwork, multiNetworks)
  const address = network.specification.indexerOptions.address

  try {
    const result = await network.networkSubgraph.checkedQuery(
      gql`
        query allocations($indexer: String!) {
          allocations(
            where: { indexer: $indexer, status: Active }
            first: 1000
            orderDirection: desc
          ) {
            id
            allocatedTokens
            createdAtEpoch
            closedAtEpoch
            subgraphDeployment {
              id
              stakedTokens
              signalledTokens
            }
          }
        }
      `,
      { indexer: address.toLocaleLowerCase() },
    )
    if (result.error) {
      throw result.error
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.data.allocations.map((allocation: any) => ({
      ...allocation,
      subgraphDeployment: new SubgraphDeploymentID(allocation.subgraphDeployment.id)
        .ipfsHash,
      signalledTokens: allocation.subgraphDeployment.signalledTokens,
      stakedTokens: allocation.subgraphDeployment.stakedTokens,
      protocolNetwork: network.specification.networkIdentifier,
    }))
  } catch (error) {
    const err = indexerError(IndexerErrorCode.IE010, error)
    logger?.error(`Failed to query indexer allocations`, {
      err,
    })
    throw err
  }
}
