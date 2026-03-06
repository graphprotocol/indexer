import gql from 'graphql-tag'
import { SubgraphClient } from '../subgraph-client'

export interface SubgraphIndexingAgreement {
  id: string
  allocationId: string
  subgraphDeploymentId: string
  state: number
  lastCollectionAt: string
  endsAt: string
  maxInitialTokens: string
  maxOngoingTokensPerSecond: string
  tokensPerSecond: string
  tokensPerEntityPerSecond: string
  minSecondsPerCollection: number
  maxSecondsPerCollection: number
  canceledAt: string
}

const INDEXING_AGREEMENTS_QUERY = gql`
  query indexingAgreements($indexer: String!, $lastId: String!) {
    indexingAgreements(
      where: {
        serviceProvider: $indexer
        state_in: [1, 3]
        id_gt: $lastId
      }
      orderBy: id
      orderDirection: asc
      first: 1000
    ) {
      id
      allocationId
      subgraphDeploymentId
      state
      lastCollectionAt
      endsAt
      maxInitialTokens
      maxOngoingTokensPerSecond
      tokensPerSecond
      tokensPerEntityPerSecond
      minSecondsPerCollection
      maxSecondsPerCollection
      canceledAt
    }
  }
`

export async function fetchCollectableAgreements(
  networkSubgraph: SubgraphClient,
  indexerAddress: string,
): Promise<SubgraphIndexingAgreement[]> {
  const all: SubgraphIndexingAgreement[] = []
  let lastId = ''

  for (;;) {
    const result = await networkSubgraph.query(INDEXING_AGREEMENTS_QUERY, {
      indexer: indexerAddress.toLowerCase(),
      lastId,
    })

    if (!result.data?.indexingAgreements?.length) break

    const agreements: SubgraphIndexingAgreement[] = result.data.indexingAgreements
    all.push(...agreements)

    if (agreements.length < 1000) break
    lastId = agreements[agreements.length - 1].id
  }

  return all
}
