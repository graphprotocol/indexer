import gql from 'graphql-tag'
import { SubgraphClient } from '../subgraph-client'

export type AgreementState =
  | 'NotAccepted'
  | 'Accepted'
  | 'CanceledByServiceProvider'
  | 'CanceledByPayer'

export interface SubgraphIndexingAgreement {
  id: string
  allocationId: string
  subgraphDeploymentId: string
  state: AgreementState
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
      where: { indexer: $indexer, state_in: [Accepted, CanceledByPayer], id_gt: $lastId }
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

export interface IndexingAgreementDetails {
  id: string
  payer: string
  indexer: string
  allocationId: string
  subgraphDeploymentId: string
  state: AgreementState
  acceptedAt: string
  lastCollectionAt: string
  endsAt: string
  tokensPerSecond: string
  tokensCollected: string
  canceledAt: string
  canceledBy: string
}

const INDEXING_AGREEMENT_DETAILS_QUERY = gql`
  query indexingAgreements($where: IndexingAgreement_filter!, $lastId: String!) {
    indexingAgreements(
      where: { and: [$where, { id_gt: $lastId }] }
      orderBy: id
      orderDirection: asc
      first: 1000
    ) {
      id
      payer
      indexer
      allocationId
      subgraphDeploymentId
      state
      acceptedAt
      lastCollectionAt
      endsAt
      tokensPerSecond
      tokensCollected
      canceledAt
      canceledBy
    }
  }
`

export async function fetchIndexingAgreements(
  subgraphClient: SubgraphClient,
  indexerAddress: string,
  filter?: { state?: AgreementState; id?: string },
): Promise<IndexingAgreementDetails[]> {
  const where: Record<string, unknown> = { indexer: indexerAddress.toLowerCase() }
  if (filter?.state) where.state = filter.state
  if (filter?.id) where.id = filter.id.toLowerCase()

  const all: IndexingAgreementDetails[] = []
  let lastId = ''

  for (;;) {
    const result = await subgraphClient.query(INDEXING_AGREEMENT_DETAILS_QUERY, {
      where,
      lastId,
    })
    if (result.error) {
      throw result.error
    }

    const agreements: IndexingAgreementDetails[] =
      result.data?.indexingAgreements ?? []
    if (!agreements.length) break

    all.push(...agreements)

    if (agreements.length < 1000) break
    lastId = agreements[agreements.length - 1].id
  }

  return all
}

export async function fetchCollectableAgreements(
  subgraphClient: SubgraphClient,
  indexerAddress: string,
): Promise<SubgraphIndexingAgreement[]> {
  const all: SubgraphIndexingAgreement[] = []
  let lastId = ''

  for (;;) {
    const result = await subgraphClient.query(INDEXING_AGREEMENTS_QUERY, {
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
